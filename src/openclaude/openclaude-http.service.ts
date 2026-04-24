import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readFile } from 'fs/promises';

export interface StreamCallbacks {
  onToken: (chunk: string) => void;
  onDone: (payload: {
    fullText: string;
    promptTokens: number;
    completionTokens: number;
  }) => Promise<void>;
  onError: (message: string) => void;
  onComplete?: () => void;
  onHtmlPreview?: (html: string, filePath: string) => void;
  onToolStart?: (payload: {
    toolName: string;
    argumentsJson: string;
    toolUseId: string | null;
  }) => void;
  onToolResult?: (payload: {
    toolName: string;
    toolUseId: string;
    output: string;
    isError: boolean;
  }) => void;
  onActionRequired?: (payload: {
    promptId: string;
    toolName: string;
    argumentsJson: string;
  }) => void;
  /**
   * Consultado antes de decidir se pede aprovação ou aprova automaticamente.
   * Se retornar 'allow'/'deny', a decisão é imediata. Se 'ask' (ou undefined),
   * segue o fluxo manualToolApproval.
   */
  resolvePermission?: (payload: {
    toolName: string;
    argumentsJson: string;
  }) => Promise<'allow' | 'deny' | 'ask'>;
}

/** Subset of Anthropic ContentBlockParam used for image/text blocks */
export interface ContentBlock {
  type: 'text' | 'image';
  text?: string;
  source?: {
    type: 'base64';
    media_type: string;
    data: string;
  };
}

@Injectable()
export class OpenClaudeHttpService implements OnModuleInit {
  private readonly logger = new Logger(OpenClaudeHttpService.name);
  private baseUrl!: string;

  constructor(private readonly configService: ConfigService) { }

  onModuleInit() {
    const host =
      this.configService.get<string>('OPENCLAUDE_HTTP_HOST') ?? '127.0.0.1';
    const port =
      this.configService.get<string>('OPENCLAUDE_HTTP_PORT') ?? '50052';
    this.baseUrl = `http://${host}:${port}`;
    this.logger.log(`OpenClaude HTTP client targeting ${this.baseUrl}`);
  }

  async getModels(): Promise<unknown[]> {
    try {
      const res = await fetch(`${this.baseUrl}/models`);
      if (!res.ok) return [];
      return res.json() as Promise<unknown[]>;
    } catch {
      return [];
    }
  }

  async getTools(): Promise<unknown[]> {
    try {
      const res = await fetch(`${this.baseUrl}/tools`);
      if (!res.ok) return [];
      return res.json() as Promise<unknown[]>;
    } catch {
      return [];
    }
  }

  /**
   * Envia a resposta (aprovar/negar) para um prompt de tool pendente no Bun.
   * Usado quando a conversa está com `manualToolApproval` ligado e o usuário
   * respondeu no modal do frontend.
   */
  async replyToolInput(
    sessionId: string,
    promptId: string,
    reply: 'y' | 'n',
  ): Promise<void> {
    await fetch(`${this.baseUrl}/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        prompt_id: promptId,
        reply,
      }),
    });
  }

  /**
   * Limpa o histórico em memória e inputs pendentes do Bun para uma sessão.
   * Útil após compactação para forçar a engine a reler o histórico enviado no body.
   */
  async resetSession(sessionId: string): Promise<void> {
    try {
      await fetch(`${this.baseUrl}/session/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId }),
      });
    } catch {
      // ignora — quando Bun estiver em outro host, no pior caso a próxima mensagem
      // ainda funcionará graças à priorização de sessionHistory.
    }
  }

  async streamChat(params: {
    sessionId: string;
    /** Plain text message — mutually exclusive with contentBlocks */
    message?: string;
    /** Pre-built content blocks (text + images) — takes priority over message */
    contentBlocks?: ContentBlock[];
    /** Previous messages loaded from DB — used to restore context after server restart */
    history?: Array<{ role: 'user' | 'assistant'; content: Array<{ type: 'text'; text: string }> }>;
    workingDirectory?: string;
    model?: string;
    systemPrompt?: string;
    /** Appended to the system prompt without replacing it — used for plan mode */
    appendSystemPrompt?: string;
    allowedTools?: string[];
    maxTurns?: number;
    /** Per-user OpenRouter/OpenAI-compatible API key */
    apiKey?: string;
    /** Provider-specific base URL override (e.g. Anthropic, OpenAI, local Ollama) */
    baseUrl?: string;
    /** Extra HTTP headers to forward to the provider */
    extraHeaders?: Record<string, string> | null;
    /** If true, do NOT auto-approve tool actions — surface them to the caller for manual approval */
    manualToolApproval?: boolean;
    /** MCP servers to register for this request (see Bun start-http-stream.ts) */
    mcpServers?: Array<Record<string, unknown>>;
    callbacks: StreamCallbacks;
  }): Promise<() => void> {
    const controller = new AbortController();

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_id: params.sessionId,
          message: params.contentBlocks ? undefined : (params.message ?? ''),
          content_blocks: params.contentBlocks,
          history: params.history,
          working_directory: params.workingDirectory,
          model: params.model,
          system_prompt: params.systemPrompt,
          append_system_prompt: params.appendSystemPrompt,
          allowed_tools: params.allowedTools,
          max_turns: params.maxTurns,
          api_key: params.apiKey,
          base_url: params.baseUrl,
          extra_headers: params.extraHeaders ?? undefined,
          mcp_servers: params.mcpServers,
        }),
        signal: controller.signal,
      });
    } catch (err: any) {
      const isRefused =
        err.code === 'ECONNREFUSED' || err.cause?.code === 'ECONNREFUSED';
      const msg = isRefused
        ? `O servidor OpenClaude não está disponível em ${this.baseUrl}. Execute: npm run dev:http`
        : (err.message ?? 'Falha ao conectar ao servidor OpenClaude');
      params.callbacks.onError(msg);
      return () => { };
    }

    if (!response.ok || !response.body) {
      params.callbacks.onError(
        `Servidor OpenClaude retornou status ${response.status}`,
      );
      return () => controller.abort();
    }

    // Maps tool_use_id → file_path for Edit calls on .html files
    const pendingHtmlEdits = new Map<string, string>();
    this.consumeStream(response.body, params, controller, pendingHtmlEdits).catch(() => { });

    return () => controller.abort();
  }

  private async consumeStream(
    body: ReadableStream<Uint8Array>,
    params: Parameters<OpenClaudeHttpService['streamChat']>[0],
    controller: AbortController,
    pendingHtmlEdits: Map<string, string>,
  ) {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop() ?? '';

        for (const part of parts) {
          await this.handleSseBlock(part, params, controller, pendingHtmlEdits);
        }
      }
    } catch (err: any) {
      if (err.name !== 'AbortError') {
        params.callbacks.onError(err.message ?? 'Erro ao ler stream');
      }
    } finally {
      params.callbacks.onComplete?.();
    }
  }

  private async handleSseBlock(
    block: string,
    params: Parameters<OpenClaudeHttpService['streamChat']>[0],
    controller: AbortController,
    pendingHtmlEdits: Map<string, string>,
  ) {
    let event = 'message';
    let dataLine = '';

    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) event = line.slice(7).trim();
      else if (line.startsWith('data: ')) dataLine = line.slice(6).trim();
    }

    if (!dataLine) return;

    let data: Record<string, any>;
    try {
      data = JSON.parse(dataLine);
    } catch {
      return;
    }

    switch (event) {
      case 'text_chunk':
        params.callbacks.onToken(String(data.text ?? ''));
        break;

      case 'action_required': {
        const promptId = String(data.prompt_id ?? '');
        const toolName = String(data.tool_name ?? '');
        const argumentsJson = String(data.arguments_json ?? '{}');

        // 1) Regra persistida (allow/deny) tem prioridade absoluta
        let decision: 'allow' | 'deny' | 'ask' = 'ask';
        if (params.callbacks.resolvePermission) {
          try {
            decision = await params.callbacks.resolvePermission({
              toolName,
              argumentsJson,
            });
          } catch {
            decision = 'ask';
          }
        }

        if (decision === 'allow' || decision === 'deny') {
          try {
            await fetch(`${this.baseUrl}/input`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                session_id: params.sessionId,
                prompt_id: promptId,
                reply: decision === 'allow' ? 'y' : 'n',
              }),
              signal: controller.signal,
            });
          } catch {
            // ignore fetch errors for tool replies
          }
          break;
        }

        // 2) ask → respeita manualToolApproval da sessão
        if (params.manualToolApproval) {
          params.callbacks.onActionRequired?.({
            promptId,
            toolName,
            argumentsJson,
          });
          break;
        }

        // 3) Default: auto-aprova
        try {
          await fetch(`${this.baseUrl}/input`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: params.sessionId,
              prompt_id: promptId,
              reply: 'y',
            }),
            signal: controller.signal,
          });
        } catch {
          // ignore fetch errors for tool replies
        }
        break;
      }

      case 'tool_start': {
        const toolName = String(data.tool_name ?? '');
        const argumentsJson = String(data.arguments_json ?? '{}');
        const toolUseId = data.tool_use_id ? String(data.tool_use_id) : null;

        params.callbacks.onToolStart?.({
          toolName,
          argumentsJson,
          toolUseId,
        });

        try {
          const args = JSON.parse(argumentsJson);
          const filePath: string = args.file_path ?? '';

          if (filePath.endsWith('.html') && params.callbacks.onHtmlPreview) {
            if (toolName === 'Write') {
              const content: string = args.content ?? '';
              if (content) params.callbacks.onHtmlPreview(content, filePath);
            } else if (toolName === 'Edit') {
              if (toolUseId) pendingHtmlEdits.set(toolUseId, filePath);
            }
          }
        } catch {
          // ignore malformed arguments
        }
        break;
      }

      case 'tool_result': {
        const toolUseId = String(data.tool_use_id ?? '');
        const toolName = String(data.tool_name ?? '');
        const output = String(data.output ?? '');
        const isError = Boolean(data.is_error);

        params.callbacks.onToolResult?.({
          toolName,
          toolUseId,
          output,
          isError,
        });

        const pendingPath = pendingHtmlEdits.get(toolUseId);
        if (pendingPath && !isError && params.callbacks.onHtmlPreview) {
          pendingHtmlEdits.delete(toolUseId);
          try {
            const updatedContent = await readFile(pendingPath, 'utf-8');
            params.callbacks.onHtmlPreview(updatedContent, pendingPath);
          } catch {
            // arquivo pode não ser acessível — ignora silenciosamente
          }
        }
        break;
      }

      case 'done':
        await params.callbacks.onDone({
          fullText: String(data.full_text ?? ''),
          promptTokens: Number(data.prompt_tokens ?? 0),
          completionTokens: Number(data.completion_tokens ?? 0),
        });
        break;

      case 'error':
        params.callbacks.onError(
          String(data.message ?? 'Erro no servidor OpenClaude'),
        );
        break;
    }
  }
}
