import {
  BadGatewayException,
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { decryptValue, encryptValue } from '../utils/encryption';

const GITHUB_API = 'https://api.github.com';
const PROVIDER = 'github';

export interface GithubStatus {
  connected: boolean;
  login: string | null;
  name: string | null;
  avatarUrl: string | null;
  connectedAt: string | null;
}

interface GithubUser {
  login: string;
  id: number;
  name: string | null;
  avatar_url: string;
}

@Injectable()
export class GithubService {
  private readonly logger = new Logger(GithubService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getStatus(userId: string): Promise<GithubStatus> {
    const row = await this.prisma.userIntegration.findUnique({
      where: { userId_provider: { userId, provider: PROVIDER } },
    });
    if (!row) {
      return {
        connected: false,
        login: null,
        name: null,
        avatarUrl: null,
        connectedAt: null,
      };
    }
    return {
      connected: true,
      login: row.accountLogin,
      name: row.accountName,
      avatarUrl: row.accountAvatar,
      connectedAt: row.createdAt.toISOString(),
    };
  }

  async connect(userId: string, token: string): Promise<GithubStatus> {
    const t = (token || '').trim();
    if (!t) throw new BadRequestException('Token obrigatorio.');

    const user = await this.githubFetch<GithubUser>(t, '/user');
    const encrypted = encryptValue(t);

    await this.prisma.userIntegration.upsert({
      where: { userId_provider: { userId, provider: PROVIDER } },
      create: {
        userId,
        provider: PROVIDER,
        tokenEncrypted: encrypted,
        accountLogin: user.login,
        accountName: user.name ?? null,
        accountAvatar: user.avatar_url,
      },
      update: {
        tokenEncrypted: encrypted,
        accountLogin: user.login,
        accountName: user.name ?? null,
        accountAvatar: user.avatar_url,
      },
    });

    this.logger.log(`User ${userId} connected GitHub account ${user.login}`);

    return {
      connected: true,
      login: user.login,
      name: user.name ?? null,
      avatarUrl: user.avatar_url,
      connectedAt: new Date().toISOString(),
    };
  }

  async disconnect(userId: string): Promise<void> {
    await this.prisma.userIntegration
      .delete({ where: { userId_provider: { userId, provider: PROVIDER } } })
      .catch(() => undefined);
    this.logger.log(`User ${userId} disconnected GitHub`);
  }

  async listRepos(userId: string, page = 1, perPage = 30) {
    const token = await this.requireToken(userId);
    const q = new URLSearchParams({
      sort: 'updated',
      per_page: String(Math.min(100, Math.max(1, perPage))),
      page: String(Math.max(1, page)),
      affiliation: 'owner,collaborator,organization_member',
    });
    return this.githubFetch(token, `/user/repos?${q.toString()}`);
  }

  async getRepoContents(
    userId: string,
    owner: string,
    repo: string,
    innerPath: string,
    ref?: string,
  ) {
    const token = await this.requireToken(userId);
    this.assertSafeSegment(owner, 'owner');
    this.assertSafeSegment(repo, 'repo');
    const safePath = this.normalizePath(innerPath);
    const refQuery = ref ? `?ref=${encodeURIComponent(ref)}` : '';
    return this.githubFetch(
      token,
      `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${safePath}${refQuery}`,
    );
  }

  /**
   * Resolve o token em plaintext. Uso INTERNO apenas (outros services do
   * backend podem chamar para executar `git clone` etc). Nunca expor em API.
   */
  async getRawTokenInternal(userId: string): Promise<string | null> {
    const row = await this.prisma.userIntegration.findUnique({
      where: { userId_provider: { userId, provider: PROVIDER } },
    });
    if (!row) return null;
    try {
      return decryptValue(row.tokenEncrypted);
    } catch (err) {
      this.logger.error(
        `Falha ao decriptar token do usuario ${userId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async requireToken(userId: string): Promise<string> {
    const token = await this.getRawTokenInternal(userId);
    if (!token) {
      throw new NotFoundException('GitHub nao conectado para este usuario.');
    }
    return token;
  }

  private async githubFetch<T = unknown>(
    token: string,
    endpoint: string,
  ): Promise<T> {
    const url = endpoint.startsWith('http') ? endpoint : `${GITHUB_API}${endpoint}`;
    let res: Response;
    try {
      res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'OpenClaude',
        },
      });
    } catch (err) {
      throw new BadGatewayException(
        `Falha ao contatar GitHub: ${(err as Error).message}`,
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new UnauthorizedException(
        'Token GitHub invalido, expirado ou sem permissao.',
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new BadGatewayException(
        `GitHub retornou ${res.status}: ${text.slice(0, 200)}`,
      );
    }

    return (await res.json()) as T;
  }

  private assertSafeSegment(value: string, label: string) {
    if (!value || /[^a-zA-Z0-9._-]/.test(value)) {
      throw new BadRequestException(`Parametro ${label} invalido.`);
    }
  }

  private normalizePath(input: string): string {
    if (!input) return '';
    if (input.includes('..')) {
      throw new BadRequestException('Path nao pode conter "..".');
    }
    return input
      .split('/')
      .filter(Boolean)
      .map((seg) => encodeURIComponent(seg))
      .join('/');
  }
}
