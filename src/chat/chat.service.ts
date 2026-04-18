import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { PrismaService } from '../prisma/prisma.service';
import {
  OpenClaudeHttpService,
  type ContentBlock,
} from '../openclaude/openclaude-http.service';
import { AdminService } from '../admin/admin.service';
import { ProvidersService } from '../providers/providers.service';
import { PermissionsService } from '../permissions/permissions.service';
import { McpService } from '../mcp/mcp.service';
import type { AuthUser } from '../auth/auth.types';
import type { AttachmentDto } from './dto/chat-stream.dto';

type StreamCallbacks = {
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
};

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
]);

@Injectable()
export class ChatService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly httpService: OpenClaudeHttpService,
    private readonly configService: ConfigService,
    private readonly adminService: AdminService,
    private readonly providersService: ProvidersService,
    private readonly permissionsService: PermissionsService,
    private readonly mcpService: McpService,
  ) { }

  async listConversations(userId: string) {
    return this.prisma.conversation.findMany({
      where: { userId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async createConversation(
    userId: string,
    data: { title: string; modelId?: string; projectId?: string | null },
  ) {
    return this.prisma.conversation.create({
      data: {
        userId,
        title: data.title,
        modelId: data.modelId,
        projectId: data.projectId ?? null,
      },
    });
  }

  async updateConversation(
    userId: string,
    conversationId: string,
    data: { title?: string; projectId?: string | null },
  ) {
    await this.assertConversationOwnership(userId, conversationId);
    return this.prisma.conversation.update({
      where: { id: conversationId },
      data: {
        ...(data.title !== undefined ? { title: data.title } : {}),
        ...(data.projectId !== undefined ? { projectId: data.projectId } : {}),
      },
    });
  }

  async deleteConversation(userId: string, conversationId: string) {
    await this.assertConversationOwnership(userId, conversationId);
    await this.prisma.conversation.delete({ where: { id: conversationId } });
    return { success: true };
  }

  async listMessages(userId: string, conversationId: string) {
    await this.assertConversationOwnership(userId, conversationId);
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async exportConversation(
    userId: string,
    conversationId: string,
    format: 'markdown' | 'json' = 'markdown',
  ): Promise<{ filename: string; mimeType: string; content: string }> {
    await this.assertConversationOwnership(userId, conversationId);
    const conv = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conv) {
      throw new NotFoundException('Conversa não encontrada');
    }
    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });

    const safeTitle = conv.title
      .replace(/[^\w\d\- ]+/g, '')
      .trim()
      .replace(/\s+/g, '-')
      .slice(0, 60) || 'conversa';

    if (format === 'json') {
      const payload = {
        id: conv.id,
        title: conv.title,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          attachments: m.attachments ?? null,
          tokensUsed: m.tokensUsed ?? null,
          createdAt: m.createdAt,
        })),
      };
      return {
        filename: `${safeTitle}.json`,
        mimeType: 'application/json; charset=utf-8',
        content: JSON.stringify(payload, null, 2),
      };
    }

    const md: string[] = [];
    md.push(`# ${conv.title}`);
    md.push('');
    md.push(`- **ID**: \`${conv.id}\``);
    md.push(`- **Criada em**: ${conv.createdAt.toISOString()}`);
    md.push(`- **Atualizada em**: ${conv.updatedAt.toISOString()}`);
    md.push(`- **Mensagens**: ${messages.length}`);
    md.push('');
    md.push('---');
    md.push('');

    for (const m of messages) {
      const label = m.role === 'user' ? '👤 Usuário' : '🤖 Assistente';
      md.push(`## ${label} — ${m.createdAt.toISOString()}`);
      md.push('');
      md.push(m.content || '*(vazio)*');
      md.push('');
      if (m.attachments && Array.isArray(m.attachments) && m.attachments.length > 0) {
        md.push('**Anexos:**');
        for (const a of m.attachments as Array<Record<string, unknown>>) {
          const name = String(a.name ?? a.filename ?? a.path ?? 'arquivo');
          md.push(`- ${name}`);
        }
        md.push('');
      }
      md.push('---');
      md.push('');
    }

    return {
      filename: `${safeTitle}.md`,
      mimeType: 'text/markdown; charset=utf-8',
      content: md.join('\n'),
    };
  }

  async createMessage(
    userId: string,
    conversationId: string,
    data: {
      role: 'user' | 'assistant';
      content: string;
      attachments?: unknown;
      tokensUsed?: number;
    },
  ) {
    await this.assertConversationOwnership(userId, conversationId);
    return this.prisma.message.create({
      data: {
        conversationId,
        role: data.role,
        content: data.content,
        attachments:
          data.attachments === undefined
            ? undefined
            : (data.attachments as Prisma.InputJsonValue),
        tokensUsed: data.tokensUsed ?? null,
      },
    });
  }

  async recordTokenUsage(data: {
    userId: string;
    conversationId: string;
    promptTokens: number;
    completionTokens: number;
    model?: string | null;
  }) {
    return this.prisma.userTokenUsage.create({
      data: {
        userId: data.userId,
        conversationId: data.conversationId,
        promptTokens: data.promptTokens,
        completionTokens: data.completionTokens,
        model: data.model ?? null,
      },
    });
  }

  async getMyTokenUsage(userId: string) {
    const rows = await this.prisma.userTokenUsage.aggregate({
      where: { userId },
      _sum: { promptTokens: true, completionTokens: true },
      _count: { id: true },
    });
    const promptTokens = rows._sum.promptTokens ?? 0;
    const completionTokens = rows._sum.completionTokens ?? 0;
    return {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      requests: rows._count.id,
    };
  }

  async getAvailableModels() {
    return this.httpService.getModels();
  }

  async getAvailableTools() {
    return this.httpService.getTools();
  }

  async getConversationSettings(userId: string, conversationId: string) {
    await this.assertConversationOwnership(userId, conversationId);
    const session = await this.prisma.chatSession.findUnique({
      where: { conversationId },
    });
    return {
      model: session?.model ?? null,
      systemPrompt: session?.systemPrompt ?? null,
      allowedTools: (session?.allowedTools as string[] | null) ?? null,
      maxTurns: session?.maxTurns ?? null,
      workingDirectory: session?.workingDirectory ?? null,
      manualToolApproval: session?.manualToolApproval ?? false,
    };
  }

  async updateConversationSettings(
    userId: string,
    conversationId: string,
    settings: {
      model?: string | null;
      systemPrompt?: string | null;
      allowedTools?: string[] | null;
      maxTurns?: number | null;
      workingDirectory?: string | null;
      manualToolApproval?: boolean;
    },
  ) {
    await this.assertConversationOwnership(userId, conversationId);

    const session = await this.prisma.chatSession.findUnique({
      where: { conversationId },
    });

    const data: Record<string, unknown> = {};
    if ('model' in settings) data.model = settings.model ?? null;
    if ('systemPrompt' in settings) data.systemPrompt = settings.systemPrompt ?? null;
    if ('allowedTools' in settings)
      data.allowedTools = settings.allowedTools ?? Prisma.DbNull;
    if ('maxTurns' in settings) data.maxTurns = settings.maxTurns ?? null;
    if ('workingDirectory' in settings)
      data.workingDirectory = settings.workingDirectory ?? null;
    if ('manualToolApproval' in settings)
      data.manualToolApproval = Boolean(settings.manualToolApproval);

    if (session) {
      return this.prisma.chatSession.update({
        where: { conversationId },
        data,
      });
    }

    // Create session with settings if it doesn't exist yet
    return this.prisma.chatSession.create({
      data: {
        conversationId,
        openclaudeSessionId: `conv-${conversationId}-${randomUUID().slice(0, 8)}`,
        workingDirectory: (settings.workingDirectory as string) ?? this.resolveDefaultWorkdir(),
        model: settings.model ?? null,
        systemPrompt: settings.systemPrompt ?? null,
        allowedTools: settings.allowedTools ?? undefined,
        maxTurns: settings.maxTurns ?? null,
        manualToolApproval: Boolean(settings.manualToolApproval ?? false),
      },
    });
  }

  async streamAssistantReply(params: {
    user: AuthUser;
    conversationId: string;
    message?: string;
    attachments?: AttachmentDto[];
    mode: 'agent' | 'plan';
    workingDirectory?: string;
    model?: string;
    systemPrompt?: string;
    allowedTools?: string[];
    maxTurns?: number;
    onStream: StreamCallbacks;
  }) {
    await this.assertConversationOwnership(params.user.id, params.conversationId);

    const chatSession = await this.ensureChatSession(params.conversationId);

    // Load global defaults as lowest-priority fallback
    const globalSettings = await this.adminService.getGlobalSettings();

    // Fetch per-user key + preferred model
    const userConfig = await this.adminService.getUserApiKeyConfig(params.user.id);

    // Provider profile do usuário (preferido) — se existir um marcado como default,
    // sobrescreve apiKey/baseUrl/defaultModel vindos do ApiKey legado.
    const activeProfile = await this.providersService.resolveActiveProfile(
      params.user.id,
    );

    const effectiveApiKey = activeProfile?.apiKey ?? userConfig.apiKey ?? undefined;
    const effectiveBaseUrl = activeProfile?.baseUrl ?? undefined;
    const effectiveExtraHeaders = activeProfile?.extraHeaders ?? undefined;

    // Priority: request param > session setting > profile default > user preferred model > global default
    const effectiveModel =
      params.model ||
      chatSession.model ||
      activeProfile?.defaultModel ||
      userConfig.preferredModelId ||
      globalSettings.model ||
      undefined;
    const baseSystemPrompt =
      params.systemPrompt ||
      chatSession.systemPrompt ||
      globalSettings.systemPrompt ||
      undefined;

    // Inject active memory notes (ContextNote.isActive) into the system prompt
    const activeNotes = await this.prisma.contextNote.findMany({
      where: { userId: params.user.id, isActive: true },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });

    let effectiveSystemPrompt = baseSystemPrompt;
    if (activeNotes.length > 0) {
      const notesBlock = activeNotes
        .map((n) => `### ${n.title}\n${n.content}`)
        .join('\n\n');
      const memorySection = `<user_memory>\nInformações persistentes do usuário. Use-as quando relevante.\n\n${notesBlock}\n</user_memory>`;
      effectiveSystemPrompt = baseSystemPrompt
        ? `${memorySection}\n\n${baseSystemPrompt}`
        : memorySection;
    }
    const effectiveAllowedTools =
      params.allowedTools ??
      (chatSession.allowedTools as string[] | null) ??
      globalSettings.allowedTools ??
      undefined;
    const effectiveMaxTurns =
      params.maxTurns ||
      chatSession.maxTurns ||
      globalSettings.maxTurns ||
      undefined;

    // Load previous messages from DB to restore context after server restarts
    const dbMessages = await this.prisma.message.findMany({
      where: { conversationId: params.conversationId },
      orderBy: { createdAt: 'asc' },
    });

    const conversationHistory =
      dbMessages.length > 0
        ? dbMessages.map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: [{ type: 'text' as const, text: m.content }],
        }))
        : undefined;

    // Resolve what to send: plain string, augmented string, or image+text blocks
    const built = await this.buildContentBlocks(
      params.message,
      params.attachments,
    );

    const isBlocks = Array.isArray(built);
    const finalMessage = isBlocks ? undefined : (built ?? params.message ?? '');
    const finalBlocks = isBlocks ? (built as ContentBlock[]) : undefined;

    // Plan mode: append planning instructions and restrict to read-only tools
    const isPlanMode = params.mode === 'plan';
    const planAppendPrompt = isPlanMode
      ? `\n\n<plan_mode_instructions>
Você está em MODO PLANEJAMENTO. Suas instruções:
1. NUNCA execute comandos, edite arquivos ou tome ações reais no sistema.
2. Analise o pedido do usuário em profundidade — leia arquivos e explore o código se necessário.
3. Produza um plano detalhado e numerado descrevendo EXATAMENTE o que você faria:
   - Quais arquivos seriam criados, editados ou removidos
   - Quais comandos seriam executados e por quê
   - Qual seria o resultado esperado de cada etapa
4. Finalize com um resumo das mudanças e possíveis riscos.
Ferramentas de leitura (Read, Grep, Glob, WebFetch, WebSearch) são permitidas para entender o contexto.
</plan_mode_instructions>`
      : undefined;

    // In plan mode: allow only read-only tools so the model cannot execute actions
    const planAllowedTools = isPlanMode
      ? ['Read', 'Glob', 'Grep', 'WebFetchTool', 'WebSearchTool']
      : undefined;

    const finalAllowedTools = isPlanMode
      ? planAllowedTools
      : effectiveAllowedTools;

    return this.httpService.streamChat({
      sessionId: chatSession.openclaudeSessionId,
      message: finalMessage,
      contentBlocks: finalBlocks,
      history: conversationHistory,
      workingDirectory:
        params.workingDirectory ||
        chatSession.workingDirectory ||
        this.resolveDefaultWorkdir(),
      model: effectiveModel,
      systemPrompt: effectiveSystemPrompt,
      appendSystemPrompt: planAppendPrompt,
      allowedTools: finalAllowedTools,
      maxTurns: effectiveMaxTurns,
      apiKey: effectiveApiKey,
      baseUrl: effectiveBaseUrl,
      extraHeaders: effectiveExtraHeaders,
      mcpServers: await this.mcpService
        .resolveEnabledForRequest(params.user.id)
        .catch(() => []),
      manualToolApproval: chatSession.manualToolApproval === true,
      callbacks: {
        onToken: params.onStream.onToken,
        onDone: async (payload) => {
          await params.onStream.onDone(payload);
        },
        onError: params.onStream.onError,
        onComplete: params.onStream.onComplete,
        onHtmlPreview: params.onStream.onHtmlPreview,
        onToolStart: params.onStream.onToolStart,
        onToolResult: params.onStream.onToolResult,
        onActionRequired: params.onStream.onActionRequired,
        resolvePermission: async ({ toolName }) => {
          const decision = await this.permissionsService.resolveDecision(
            params.user.id,
            params.conversationId,
            toolName,
          );
          await this.permissionsService.logDecision({
            userId: params.user.id,
            conversationId: params.conversationId,
            toolName,
            decision,
          });
          return decision;
        },
      },
    });
  }

  /**
   * Compacta a conversa gerando um resumo com o modelo configurado,
   * substituindo o histórico do DB por uma única mensagem com o resumo
   * e limpando o cache de sessionHistory no Bun.
   */
  async compactConversation(userId: string, conversationId: string) {
    await this.assertConversationOwnership(userId, conversationId);
    const chatSession = await this.ensureChatSession(conversationId);

    const messages = await this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
    });

    if (messages.length < 2) {
      return {
        summary: '',
        messagesRemoved: 0,
        skipped: true,
        reason: 'Conversa muito curta para compactar',
      };
    }

    const transcript = messages
      .map((m) => `${m.role === 'user' ? 'USUÁRIO' : 'ASSISTENTE'}:\n${m.content}`)
      .join('\n\n---\n\n');

    const summaryInstruction = `Você recebeu uma transcrição abaixo. Produza um RESUMO em português que preserve todo o contexto essencial para continuar a conversa.

Inclua:
1. Objetivo do usuário e intenção geral
2. Decisões técnicas tomadas e opções descartadas
3. Arquivos criados, modificados ou analisados e principais mudanças
4. Tarefas concluídas, em andamento e pendentes
5. Dados, IDs, paths ou parâmetros importantes citados
6. Erros encontrados e como foram resolvidos

Formato: markdown com seções. Seja conciso mas completo. NÃO invente informações.

Transcrição:

${transcript}`;

    const globalSettings = await this.adminService.getGlobalSettings();
    const userConfig = await this.adminService.getUserApiKeyConfig(userId);
    const effectiveModel =
      chatSession.model ||
      userConfig.preferredModelId ||
      globalSettings.model ||
      undefined;

    const summary = await new Promise<string>((resolve, reject) => {
      let accumulated = '';
      this.httpService
        .streamChat({
          sessionId: `compact-${conversationId}-${Date.now()}`,
          message: summaryInstruction,
          workingDirectory:
            chatSession.workingDirectory || this.resolveDefaultWorkdir(),
          model: effectiveModel,
          allowedTools: [],
          apiKey: userConfig.apiKey ?? undefined,
          callbacks: {
            onToken: (chunk) => {
              accumulated += chunk;
            },
            onDone: async ({ fullText }) => {
              resolve((fullText || accumulated).trim());
            },
            onError: (msg) => reject(new Error(msg)),
          },
        })
        .catch(reject);
    });

    if (!summary) {
      throw new Error('Falha ao gerar resumo — resposta vazia do modelo');
    }

    const summaryBody = `**[Resumo compactado da conversa]**\n\n${summary}`;

    await this.prisma.$transaction(async (tx) => {
      await tx.message.deleteMany({ where: { conversationId } });
      await tx.message.create({
        data: {
          conversationId,
          role: 'assistant',
          content: summaryBody,
        },
      });
    });

    await this.httpService.resetSession(chatSession.openclaudeSessionId);

    return {
      summary: summaryBody,
      messagesRemoved: messages.length,
      skipped: false,
    };
  }

  /**
   * Apaga a mensagem informada e todas as posteriores. Útil para "voltar" no
   * tempo e reescrever a partir de um ponto anterior da conversa.
   * Retorna a conversa resultante (últimas mensagens restantes).
   */
  async rewindConversation(
    userId: string,
    conversationId: string,
    fromMessageId: string,
  ) {
    await this.assertConversationOwnership(userId, conversationId);

    const target = await this.prisma.message.findUnique({
      where: { id: fromMessageId },
    });
    if (!target || target.conversationId !== conversationId) {
      throw new NotFoundException('Mensagem não encontrada nesta conversa');
    }

    const deleted = await this.prisma.message.deleteMany({
      where: {
        conversationId,
        createdAt: { gte: target.createdAt },
      },
    });

    // Limpa cache de sessionHistory no Bun para que próxima request use DB.
    const chatSession = await this.prisma.chatSession.findUnique({
      where: { conversationId },
    });
    if (chatSession) {
      await this.httpService.resetSession(chatSession.openclaudeSessionId);
    }

    const content = target.content;
    const role = target.role;

    return {
      deletedCount: deleted.count,
      rewoundFromRole: role,
      rewoundContent: content,
    };
  }

  async replyToolApproval(
    userId: string,
    conversationId: string,
    promptId: string,
    approved: boolean,
  ) {
    await this.assertConversationOwnership(userId, conversationId);
    const session = await this.prisma.chatSession.findUnique({
      where: { conversationId },
    });
    if (!session) {
      throw new NotFoundException('Sessão de chat não encontrada');
    }
    await this.httpService.replyToolInput(
      session.openclaudeSessionId,
      promptId,
      approved ? 'y' : 'n',
    );
    return { ok: true };
  }

  /**
   * Build the prompt to send to openclaude from message text + attachments.
   *
   * Returns:
   *   - null              → no attachments; caller uses plain `message`
   *   - string            → only docs/audio; augmented text message with file paths
   *   - ContentBlock[]    → has images; multi-modal array (image blocks + text block)
   */
  private async buildContentBlocks(
    message: string | undefined,
    attachments: AttachmentDto[] | undefined,
  ): Promise<ContentBlock[] | string | null> {
    if (!attachments || attachments.length === 0) return null;

    const imageBlocks: ContentBlock[] = [];
    const uploadDir = join(process.cwd(), 'uploads');
    const docPaths: string[] = [];

    for (const att of attachments) {
      if (att.type === 'image' && IMAGE_MIME_TYPES.has(att.mimeType)) {
        try {
          const data = await readFile(join(uploadDir, att.storedName));
          imageBlocks.push({
            type: 'image',
            source: {
              type: 'base64',
              media_type: att.mimeType,
              data: data.toString('base64'),
            },
          });
        } catch {
          docPaths.push(`${att.name} (${join(uploadDir, att.storedName)})`);
        }
      } else {
        // Documents and audio: pass path so ReadFile tool can access them
        docPaths.push(`${att.name} → ${join(uploadDir, att.storedName)}`);
      }
    }

    const baseText = message?.trim() ?? '';

    // Build suffix with doc/audio references
    let textSuffix = '';
    if (docPaths.length > 0) {
      const refList = docPaths.map((p) => `- ${p}`).join('\n');
      textSuffix = `\n\nArquivos anexados (use a ferramenta ReadFile para acessá-los):\n${refList}`;
    }

    const fullText = baseText + textSuffix || 'Analise os arquivos anexados.';

    if (imageBlocks.length === 0) {
      // Text-only path — return plain string (QueryEngine handles this correctly)
      return fullText;
    }

    // Multi-modal path — image blocks first, then text block
    return [...imageBlocks, { type: 'text' as const, text: fullText }];
  }

  private async ensureChatSession(conversationId: string) {
    const existing = await this.prisma.chatSession.findUnique({
      where: { conversationId },
    });
    if (existing) return existing;

    return this.prisma.chatSession.create({
      data: {
        conversationId,
        openclaudeSessionId: `conv-${conversationId}-${randomUUID().slice(0, 8)}`,
        workingDirectory: this.resolveDefaultWorkdir(),
      },
    });
  }

  private resolveDefaultWorkdir() {
    return this.configService.get<string>('OPENCLAUDE_WORKDIR') || process.cwd();
  }

  private async assertConversationOwnership(userId: string, conversationId: string) {
    const conversation = await this.prisma.conversation.findUnique({
      where: { id: conversationId },
    });
    if (!conversation) throw new NotFoundException('Conversation not found');
    if (conversation.userId !== userId)
      throw new ForbiddenException('Conversation does not belong to user');
    return conversation;
  }

}
