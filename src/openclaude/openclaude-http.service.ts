import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface StreamCallbacks {
  onToken: (chunk: string) => void;
  onDone: (payload: {
    fullText: string;
    promptTokens: number;
    completionTokens: number;
  }) => Promise<void>;
  onError: (message: string) => void;
  onComplete?: () => void;
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

  constructor(private readonly configService: ConfigService) {}

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
      return () => {};
    }

    if (!response.ok || !response.body) {
      params.callbacks.onError(
        `Servidor OpenClaude retornou status ${response.status}`,
      );
      return () => controller.abort();
    }

    this.consumeStream(response.body, params, controller).catch(() => {});

    return () => controller.abort();
  }

  private async consumeStream(
    body: ReadableStream<Uint8Array>,
    params: Parameters<OpenClaudeHttpService['streamChat']>[0],
    controller: AbortController,
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
          await this.handleSseBlock(part, params, controller);
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
        try {
          await fetch(`${this.baseUrl}/input`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_id: params.sessionId,
              prompt_id: data.prompt_id,
              reply: 'y',
            }),
            signal: controller.signal,
          });
        } catch {
          // ignore fetch errors for tool replies
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
