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
  ) {}

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

    // Priority: request param > session setting > user preferred model > global default
    const effectiveModel =
      params.model ||
      chatSession.model ||
      userConfig.preferredModelId ||
      globalSettings.model ||
      undefined;
    const effectiveSystemPrompt =
      params.systemPrompt ||
      chatSession.systemPrompt ||
      globalSettings.systemPrompt ||
      undefined;
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
      apiKey: userConfig.apiKey ?? undefined,
      callbacks: {
        onToken: params.onStream.onToken,
        onDone: async (payload) => {
          await params.onStream.onDone(payload);
        },
        onError: params.onStream.onError,
        onComplete: params.onStream.onComplete,
      },
    });
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
