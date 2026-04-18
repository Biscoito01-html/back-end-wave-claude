import {
  ForbiddenException,
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { promises as fs } from 'fs';
import * as path from 'path';
import { PrismaService } from '../prisma/prisma.service';

const META_FILE = '.workspace-meta.json';

@Injectable()
export class WorkspaceService implements OnApplicationBootstrap {
  private readonly logger = new Logger(WorkspaceService.name);
  private cachedGlobalOverride: string | null | undefined;
  private cacheAt = 0;
  private static readonly CACHE_MS = 5_000;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async onApplicationBootstrap() {
    try {
      const root = await this.getRoot();
      await fs.mkdir(root, { recursive: true });
      this.logger.log(`Workspaces root ready at ${root}`);
    } catch (err) {
      this.logger.error(
        `Failed to prepare workspaces root: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Resolve the root folder under which per-user workspaces live.
   * Priority: GlobalSetting 'workingDirectory' (admin override) > env WORKSPACES_ROOT
   * > {cwd}/workspaces.
   */
  async getRoot(): Promise<string> {
    const now = Date.now();
    let override = this.cachedGlobalOverride;
    if (override === undefined || now - this.cacheAt > WorkspaceService.CACHE_MS) {
      try {
        const row = await this.prisma.globalSetting.findUnique({
          where: { key: 'workingDirectory' },
        });
        override = row?.value?.trim() || null;
      } catch {
        override = null;
      }
      this.cachedGlobalOverride = override;
      this.cacheAt = now;
    }

    const fromEnv = this.configService.get<string>('WORKSPACES_ROOT');
    const raw = override || fromEnv || path.join(process.cwd(), 'workspaces');
    return path.resolve(raw);
  }

  /** Drop the cached override (e.g. after admin updates the global setting). */
  invalidateCache() {
    this.cachedGlobalOverride = undefined;
    this.cacheAt = 0;
  }

  async getUserRoot(userId: string): Promise<string> {
    if (!userId || userId.includes('/') || userId.includes('\\')) {
      throw new ForbiddenException('Invalid userId');
    }
    return path.join(await this.getRoot(), userId);
  }

  async ensureUserRoot(userId: string): Promise<string> {
    const userRoot = await this.getUserRoot(userId);
    await fs.mkdir(userRoot, { recursive: true });

    const metaPath = path.join(userRoot, META_FILE);
    try {
      await fs.access(metaPath);
    } catch {
      await fs.writeFile(
        metaPath,
        JSON.stringify(
          { userId, createdAt: new Date().toISOString() },
          null,
          2,
        ),
        'utf8',
      );
      this.logger.log(`Created workspace for user ${userId} at ${userRoot}`);
    }
    return userRoot;
  }

  /**
   * Resolve a subpath within the user's workspace. Accepts null/undefined/empty
   * (returns the root). Rejects absolute paths or traversal attempts (`..`).
   */
  async resolveForUser(
    userId: string,
    relPath?: string | null,
  ): Promise<string> {
    const userRoot = await this.ensureUserRoot(userId);

    if (!relPath || !relPath.trim()) return userRoot;

    const trimmed = relPath.trim();

    if (path.isAbsolute(trimmed)) {
      const resolved = path.resolve(trimmed);
      if (
        resolved === userRoot ||
        resolved.startsWith(userRoot + path.sep)
      ) {
        return resolved;
      }
      this.logger.warn(
        `Rejected absolute path for user ${userId}: ${trimmed}`,
      );
      throw new ForbiddenException(
        'Caminho fora do workspace do usuario.',
      );
    }

    const resolved = path.resolve(userRoot, trimmed);
    if (resolved !== userRoot && !resolved.startsWith(userRoot + path.sep)) {
      this.logger.warn(
        `Rejected traversal for user ${userId}: ${trimmed}`,
      );
      throw new ForbiddenException(
        'Caminho fora do workspace do usuario.',
      );
    }
    return resolved;
  }

  async removeUserRoot(userId: string): Promise<void> {
    const userRoot = await this.getUserRoot(userId);
    try {
      await fs.rm(userRoot, { recursive: true, force: true });
      this.logger.log(`Removed workspace for user ${userId}`);
    } catch (err) {
      this.logger.warn(
        `Failed to remove workspace ${userRoot}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Recursive disk usage in bytes. Cached-in-memory for 30s per user (simple Map).
   * Non-critical: best-effort; throws on I/O errors but callers may ignore.
   */
  private duCache = new Map<string, { bytes: number; at: number }>();
  async diskUsage(userId: string): Promise<number> {
    const now = Date.now();
    const cached = this.duCache.get(userId);
    if (cached && now - cached.at < 30_000) return cached.bytes;

    const userRoot = await this.getUserRoot(userId);
    let total = 0;
    async function walk(dir: string) {
      let entries: import('fs').Dirent[] = [];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full);
        } else if (e.isFile()) {
          try {
            const st = await fs.stat(full);
            total += st.size;
          } catch {}
        }
      }
    }
    await walk(userRoot);
    this.duCache.set(userId, { bytes: total, at: now });
    return total;
  }
}
