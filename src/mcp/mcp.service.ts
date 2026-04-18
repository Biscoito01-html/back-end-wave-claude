import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { encryptValue, decryptValue } from '../utils/encryption';

export type McpTransport = 'stdio' | 'sse' | 'http' | 'ws';

interface CreateMcpInput {
  name: string;
  transport: McpTransport | string;
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  env?: Record<string, string> | null;
  headers?: Record<string, string> | null;
  enabled?: boolean;
}

interface UpdateMcpInput extends Partial<CreateMcpInput> {}

const ALLOWED_TRANSPORTS: McpTransport[] = ['stdio', 'sse', 'http', 'ws'];

@Injectable()
export class McpService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const items = await this.prisma.mcpServer.findMany({
      where: { userId },
      orderBy: { createdAt: 'asc' },
    });
    return items.map((i) => this.toPublic(i));
  }

  async create(userId: string, data: CreateMcpInput) {
    const transport = this.normalizeTransport(data.transport);
    return this.toPublic(
      await this.prisma.mcpServer.create({
        data: {
          userId,
          name: data.name.trim() || 'MCP server',
          transport,
          command: data.command ?? null,
          args: (data.args ?? null) as any,
          url: data.url ?? null,
          env: data.env ? this.encryptMap(data.env) : (null as any),
          headers: data.headers ? this.encryptMap(data.headers) : (null as any),
          enabled: data.enabled ?? true,
        },
      }),
    );
  }

  async update(userId: string, id: string, data: UpdateMcpInput) {
    const existing = await this.prisma.mcpServer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('MCP server não encontrado');
    if (existing.userId !== userId) throw new ForbiddenException();

    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.transport !== undefined)
      patch.transport = this.normalizeTransport(data.transport);
    if (data.command !== undefined) patch.command = data.command;
    if (data.args !== undefined) patch.args = data.args as any;
    if (data.url !== undefined) patch.url = data.url;
    if (data.env !== undefined)
      patch.env = data.env ? this.encryptMap(data.env) : (null as any);
    if (data.headers !== undefined)
      patch.headers = data.headers ? this.encryptMap(data.headers) : (null as any);
    if (data.enabled !== undefined) patch.enabled = data.enabled;

    return this.toPublic(
      await this.prisma.mcpServer.update({ where: { id }, data: patch }),
    );
  }

  async remove(userId: string, id: string) {
    const existing = await this.prisma.mcpServer.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('MCP server não encontrado');
    if (existing.userId !== userId) throw new ForbiddenException();
    await this.prisma.mcpServer.delete({ where: { id } });
    return { success: true };
  }

  /**
   * Retorna servers habilitados do usuário em formato pronto para o Bun
   * (secrets descriptografados). Usado pelo ChatService ao iniciar um stream.
   */
  async resolveEnabledForRequest(
    userId: string,
  ): Promise<Array<Record<string, unknown>>> {
    const items = await this.prisma.mcpServer.findMany({
      where: { userId, enabled: true },
      orderBy: { createdAt: 'asc' },
    });

    return items.map((i) => ({
      name: i.name,
      transport: i.transport,
      command: i.command ?? undefined,
      args: (i.args as any) ?? undefined,
      url: i.url ?? undefined,
      env: i.env ? this.decryptMap(i.env as any) : undefined,
      headers: i.headers ? this.decryptMap(i.headers as any) : undefined,
    }));
  }

  private normalizeTransport(value: string): McpTransport {
    const v = (value ?? '').toLowerCase().trim() as McpTransport;
    return ALLOWED_TRANSPORTS.includes(v) ? v : 'stdio';
  }

  private encryptMap(map: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      out[k] = encryptValue(v ?? '');
    }
    return out;
  }

  private decryptMap(map: Record<string, string>): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(map)) {
      try {
        out[k] = decryptValue(v);
      } catch {
        out[k] = '';
      }
    }
    return out;
  }

  private toPublic<T extends { env: any; headers: any }>(item: T) {
    const envKeys = item.env ? Object.keys(item.env as Record<string, string>) : [];
    const headerKeys = item.headers
      ? Object.keys(item.headers as Record<string, string>)
      : [];
    return {
      ...item,
      env: envKeys,
      headers: headerKeys,
    };
  }
}
