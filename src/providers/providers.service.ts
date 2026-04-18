import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptValue, encryptValue, keyPreview } from '../utils/encryption';

const ALLOWED_PROVIDERS = [
  'openrouter',
  'anthropic',
  'openai',
  'google',
  'custom',
] as const;
type Provider = (typeof ALLOWED_PROVIDERS)[number];

interface CreateProfileInput {
  name: string;
  provider: Provider | string;
  apiKey: string;
  baseUrl?: string | null;
  defaultModel?: string | null;
  extraHeaders?: Record<string, string> | null;
  isDefault?: boolean;
}

interface UpdateProfileInput {
  name?: string;
  provider?: Provider | string;
  apiKey?: string | null;
  baseUrl?: string | null;
  defaultModel?: string | null;
  extraHeaders?: Record<string, string> | null;
  isDefault?: boolean;
}

@Injectable()
export class ProvidersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const items = await this.prisma.providerProfile.findMany({
      where: { userId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
    });
    return items.map((p) => this.sanitize(p));
  }

  async get(userId: string, id: string) {
    const p = await this.prisma.providerProfile.findUnique({ where: { id } });
    if (!p) throw new NotFoundException('Profile não encontrado');
    if (p.userId !== userId) throw new ForbiddenException();
    return this.sanitize(p);
  }

  async create(userId: string, data: CreateProfileInput) {
    const provider = this.normalizeProvider(data.provider);
    const apiKey = (data.apiKey ?? '').trim();
    if (!apiKey) throw new NotFoundException('API key é obrigatória');

    const created = await this.prisma.$transaction(async (tx) => {
      if (data.isDefault) {
        await tx.providerProfile.updateMany({
          where: { userId, isDefault: true },
          data: { isDefault: false },
        });
      }

      return tx.providerProfile.create({
        data: {
          userId,
          name: data.name.trim() || `${provider} profile`,
          provider,
          baseUrl: data.baseUrl ?? null,
          encryptedKey: encryptValue(apiKey),
          keyPreview: keyPreview(apiKey),
          defaultModel: data.defaultModel ?? null,
          extraHeaders: (data.extraHeaders ?? null) as any,
          isDefault: Boolean(data.isDefault),
        },
      });
    });

    return this.sanitize(created);
  }

  async update(userId: string, id: string, data: UpdateProfileInput) {
    const existing = await this.prisma.providerProfile.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Profile não encontrado');
    if (existing.userId !== userId) throw new ForbiddenException();

    const updateData: Record<string, unknown> = {};
    if (data.name !== undefined) updateData.name = data.name;
    if (data.provider !== undefined)
      updateData.provider = this.normalizeProvider(data.provider);
    if (data.baseUrl !== undefined) updateData.baseUrl = data.baseUrl;
    if (data.defaultModel !== undefined)
      updateData.defaultModel = data.defaultModel;
    if (data.extraHeaders !== undefined)
      updateData.extraHeaders = data.extraHeaders as any;

    if (data.apiKey !== undefined && data.apiKey !== null && data.apiKey.trim() !== '') {
      updateData.encryptedKey = encryptValue(data.apiKey.trim());
      updateData.keyPreview = keyPreview(data.apiKey.trim());
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (data.isDefault === true) {
        await tx.providerProfile.updateMany({
          where: { userId, isDefault: true, NOT: { id } },
          data: { isDefault: false },
        });
        updateData.isDefault = true;
      } else if (data.isDefault === false) {
        updateData.isDefault = false;
      }

      return tx.providerProfile.update({ where: { id }, data: updateData });
    });

    return this.sanitize(updated);
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.providerProfile.findUnique({
      where: { id },
    });
    if (!existing) throw new NotFoundException('Profile não encontrado');
    if (existing.userId !== userId) throw new ForbiddenException();
    await this.prisma.providerProfile.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Resolve o profile ativo do usuário, retornando apiKey descriptografada.
   * Prioriza isDefault; se não houver nenhum, retorna null.
   */
  async resolveActiveProfile(userId: string): Promise<{
    apiKey: string;
    baseUrl: string | null;
    defaultModel: string | null;
    provider: string;
    extraHeaders: Record<string, string> | null;
  } | null> {
    const profile = await this.prisma.providerProfile.findFirst({
      where: { userId, isDefault: true },
    });
    if (!profile) return null;
    return {
      apiKey: decryptValue(profile.encryptedKey),
      baseUrl: profile.baseUrl ?? null,
      defaultModel: profile.defaultModel ?? null,
      provider: profile.provider,
      extraHeaders: (profile.extraHeaders as any) ?? null,
    };
  }

  private normalizeProvider(p: string): string {
    const v = p.toLowerCase().trim();
    return ALLOWED_PROVIDERS.includes(v as Provider) ? v : 'custom';
  }

  private sanitize<T extends { encryptedKey: string }>(profile: T) {
    // Remove encryptedKey from API response
    const { encryptedKey: _key, ...rest } = profile;
    return rest;
  }
}
