import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptValue, decryptValue, keyPreview } from '../utils/encryption';

export interface GlobalSettings {
  model: string | null;
  systemPrompt: string | null;
  allowedTools: string[] | null;
  maxTurns: number | null;
  workingDirectory: string | null;
}

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService) { }

  // ── Global settings ────────────────────────────────────────────────
  async getGlobalSettings(): Promise<GlobalSettings> {
    const rows = await this.prisma.globalSetting.findMany();
    const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
    return {
      model: map['model'] ?? null,
      systemPrompt: map['systemPrompt'] ?? null,
      allowedTools: map['allowedTools'] ? (JSON.parse(map['allowedTools']) as string[]) : null,
      maxTurns: map['maxTurns'] ? parseInt(map['maxTurns'], 10) : null,
      workingDirectory: map['workingDirectory'] ?? null,
    };
  }

  async updateGlobalSettings(
    settings: Partial<{
      model: string | null;
      systemPrompt: string | null;
      allowedTools: string[] | null;
      maxTurns: number | null;
      workingDirectory: string | null;
    }>,
  ): Promise<GlobalSettings> {
    const ops: Promise<unknown>[] = [];
    for (const [key, value] of Object.entries(settings)) {
      if (value === null || value === undefined) {
        ops.push(this.prisma.globalSetting.deleteMany({ where: { key } }));
      } else {
        const serialized = typeof value === 'object' ? JSON.stringify(value) : String(value);
        ops.push(
          this.prisma.globalSetting.upsert({
            where: { key },
            create: { key, value: serialized },
            update: { value: serialized },
          }),
        );
      }
    }
    await Promise.all(ops);
    return this.getGlobalSettings();
  }

  // ── Users ──────────────────────────────────────────────────────────
  async listUsers() {
    const [users, keys] = await Promise.all([
      this.prisma.user.findMany({
        select: { id: true, email: true, name: true, role: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.apiKey.findMany({
        select: {
          id: true,
          label: true,
          keyPreview: true,
          assignedUserId: true,
          preferredModelId: true,
        },
      }),
    ]);

    const keyByUserId = new Map(
      keys.filter((k) => k.assignedUserId).map((k) => [k.assignedUserId!, k]),
    );

    return users.map((u) => ({
      ...u,
      assignedKey: keyByUserId.get(u.id) ?? null,
    }));
  }

  async updateUserRole(id: string, role: 'user' | 'admin') {
    if (role === 'user') {
      const adminCount = await this.prisma.user.count({ where: { role: 'admin' } });
      const target = await this.prisma.user.findUnique({ where: { id } });
      if (target?.role === 'admin' && adminCount <= 1) {
        throw new BadRequestException('Não é possível remover o único administrador.');
      }
    }
    return this.prisma.user.update({ where: { id }, data: { role } });
  }

  // ── API Keys ───────────────────────────────────────────────────────
  async listApiKeys() {
    const keys = await this.prisma.apiKey.findMany({
      select: {
        id: true,
        label: true,
        keyPreview: true,
        assignedUserId: true,
        preferredModelId: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const userIds = keys.map((k) => k.assignedUserId).filter(Boolean) as string[];
    const users =
      userIds.length > 0
        ? await this.prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, name: true },
        })
        : [];
    const userById = new Map(users.map((u) => [u.id, u]));

    return keys.map((k) => ({
      ...k,
      assignedUser: k.assignedUserId ? (userById.get(k.assignedUserId) ?? null) : null,
    }));
  }

  async createApiKey(label: string, plainKey: string) {
    if (!plainKey.trim()) throw new BadRequestException('A chave não pode ser vazia.');
    const encrypted = encryptValue(plainKey.trim());
    const preview = keyPreview(plainKey.trim());
    return this.prisma.apiKey.create({
      data: { label, encryptedKey: encrypted, keyPreview: preview },
      select: {
        id: true,
        label: true,
        keyPreview: true,
        assignedUserId: true,
        preferredModelId: true,
        createdAt: true,
      },
    });
  }

  async deleteApiKey(id: string) {
    const key = await this.prisma.apiKey.findUnique({ where: { id } });
    if (!key) throw new NotFoundException('Chave não encontrada.');
    await this.prisma.apiKey.delete({ where: { id } });
    return { success: true };
  }

  async assignApiKey(keyId: string, userId: string | null) {
    const key = await this.prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key) throw new NotFoundException('Chave não encontrada.');

    if (userId !== null) {
      const user = await this.prisma.user.findUnique({ where: { id: userId } });
      if (!user) throw new NotFoundException('Usuário não encontrado.');

      await this.prisma.apiKey.updateMany({
        where: { assignedUserId: userId, id: { not: keyId } },
        data: { assignedUserId: null },
      });
    }

    return this.prisma.apiKey.update({
      where: { id: keyId },
      data: { assignedUserId: userId },
      select: {
        id: true,
        label: true,
        keyPreview: true,
        assignedUserId: true,
        preferredModelId: true,
        createdAt: true,
      },
    });
  }

  async setApiKeyModel(keyId: string, modelId: string | null) {
    const key = await this.prisma.apiKey.findUnique({ where: { id: keyId } });
    if (!key) throw new NotFoundException('Chave não encontrada.');
    return this.prisma.apiKey.update({
      where: { id: keyId },
      data: { preferredModelId: modelId },
      select: {
        id: true,
        label: true,
        keyPreview: true,
        assignedUserId: true,
        preferredModelId: true,
        createdAt: true,
      },
    });
  }

  // ── Token usage ────────────────────────────────────────────────────
  async listUsageByUser() {
    const [users, grouped] = await Promise.all([
      this.prisma.user.findMany({
        select: { id: true, email: true, name: true },
      }),
      this.prisma.userTokenUsage.groupBy({
        by: ['userId'],
        _sum: { promptTokens: true, completionTokens: true },
        _count: { id: true },
        _max: { createdAt: true },
      }),
    ]);

    const userById = new Map(users.map((u) => [u.id, u]));

    return grouped.map((g) => {
      const user = userById.get(g.userId);
      const prompt = g._sum.promptTokens ?? 0;
      const completion = g._sum.completionTokens ?? 0;
      return {
        userId: g.userId,
        email: user?.email ?? '(removido)',
        name: user?.name ?? null,
        promptTokens: prompt,
        completionTokens: completion,
        totalTokens: prompt + completion,
        requests: g._count.id,
        lastUsedAt: g._max.createdAt,
      };
    });
  }

  async getUserUsageHistory(userId: string) {
    return this.prisma.userTokenUsage.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      select: {
        id: true,
        conversationId: true,
        promptTokens: true,
        completionTokens: true,
        model: true,
        createdAt: true,
      },
    });
  }

  /** Used internally by ChatService */
  async getUserApiKeyConfig(userId: string): Promise<{
    apiKey: string | null;
    preferredModelId: string | null;
  }> {
    const key = await this.prisma.apiKey.findFirst({
      where: { assignedUserId: userId },
      select: { encryptedKey: true, preferredModelId: true },
    });
    if (!key) return { apiKey: null, preferredModelId: null };
    try {
      return {
        apiKey: decryptValue(key.encryptedKey),
        preferredModelId: key.preferredModelId,
      };
    } catch {
      return { apiKey: null, preferredModelId: null };
    }
  }

  /** @deprecated Use getUserApiKeyConfig instead */
  async getUserDecryptedApiKey(userId: string): Promise<string | null> {
    return (await this.getUserApiKeyConfig(userId)).apiKey;
  }

  /** Fetch models from OpenRouter using the first available API key in the DB */
  async fetchOpenRouterModels(filter?: { supportedParameters?: string }) {
    const key = await this.prisma.apiKey.findFirst({
      select: { encryptedKey: true },
      orderBy: { createdAt: 'asc' },
    });

    let apiKey: string | null = null;
    if (key) {
      try { apiKey = decryptValue(key.encryptedKey); } catch { }
    }
    // Fallback to OPENAI_API_KEY env if no key in DB
    apiKey ??= process.env.OPENAI_API_KEY ?? null;

    if (!apiKey) {
      throw new BadRequestException(
        'Nenhuma chave de API encontrada. Cadastre uma chave no painel para buscar os modelos.',
      );
    }

    const params = new URLSearchParams({ supported_parameters: filter?.supportedParameters ?? 'tools' });
    const response = await fetch(
      `https://openrouter.ai/api/v1/models?${params.toString()}`,
      { headers: { Authorization: `Bearer ${apiKey}` } },
    );

    if (!response.ok) {
      throw new BadRequestException(`OpenRouter retornou status ${response.status}`);
    }

    const json = (await response.json()) as { data: any[] };
    return (json.data ?? []).map((m: any) => ({
      id: m.id as string,
      name: (m.name as string) ?? m.id,
      provider: ((m.id as string).split('/')[0]) ?? 'unknown',
      contextLength: (m.context_length as number) ?? 0,
      promptPrice: parseFloat(m.pricing?.prompt ?? '0'),
      completionPrice: parseFloat(m.pricing?.completion ?? '0'),
      vision: Array.isArray(m.architecture?.modalities?.input)
        ? (m.architecture.modalities.input as string[]).includes('image')
        : false,
    }));
  }
}
