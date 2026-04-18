import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export type PermissionMode = 'allow' | 'deny' | 'ask';

function normalizeMode(mode: string): PermissionMode {
  if (mode === 'allow' || mode === 'deny' || mode === 'ask') return mode;
  return 'ask';
}

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string, conversationId?: string | null) {
    return this.prisma.toolPermissionRule.findMany({
      where: {
        userId,
        conversationId: conversationId ?? null,
      },
      orderBy: { toolName: 'asc' },
    });
  }

  async listAllForUser(userId: string) {
    return this.prisma.toolPermissionRule.findMany({
      where: { userId },
      orderBy: [{ conversationId: 'asc' }, { toolName: 'asc' }],
    });
  }

  async upsert(
    userId: string,
    data: {
      toolName: string;
      mode: string;
      conversationId?: string | null;
    },
  ) {
    const mode = normalizeMode(data.mode);
    const conversationId = data.conversationId ?? null;

    const existing = await this.prisma.toolPermissionRule.findFirst({
      where: { userId, conversationId, toolName: data.toolName },
    });

    if (existing) {
      return this.prisma.toolPermissionRule.update({
        where: { id: existing.id },
        data: { mode },
      });
    }

    return this.prisma.toolPermissionRule.create({
      data: { userId, conversationId, toolName: data.toolName, mode },
    });
  }

  async remove(userId: string, id: string) {
    const rule = await this.prisma.toolPermissionRule.findUnique({
      where: { id },
    });
    if (!rule) throw new NotFoundException('Rule não encontrada');
    if (rule.userId !== userId) throw new ForbiddenException();
    await this.prisma.toolPermissionRule.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Resolve a decisão para uma tool numa conversa específica.
   * Precedência: regra da conversa > regra global do usuário > 'ask' (default).
   */
  async resolveDecision(
    userId: string,
    conversationId: string,
    toolName: string,
  ): Promise<PermissionMode> {
    const conversationRule = await this.prisma.toolPermissionRule.findFirst({
      where: { userId, conversationId, toolName },
    });
    if (conversationRule) return normalizeMode(conversationRule.mode);

    const globalRule = await this.prisma.toolPermissionRule.findFirst({
      where: { userId, conversationId: null, toolName },
    });
    if (globalRule) return normalizeMode(globalRule.mode);

    return 'ask';
  }

  async logDecision(data: {
    userId: string;
    conversationId: string | null;
    toolName: string;
    decision: PermissionMode;
    reason?: string | null;
  }) {
    try {
      await this.prisma.toolAuditLog.create({
        data: {
          userId: data.userId,
          conversationId: data.conversationId,
          toolName: data.toolName,
          decision: data.decision,
          reason: data.reason ?? null,
        },
      });
    } catch {
      // não bloquear se o log falhar
    }
  }
}
