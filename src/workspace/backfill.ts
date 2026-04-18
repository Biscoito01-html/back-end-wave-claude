/**
 * Script one-off para garantir que todos os usuarios existentes tenham
 * workspace criado em disco.
 *
 * Uso (a partir de back-end/openclaude/):
 *   npx ts-node src/workspace/backfill.ts
 *   # ou com o projeto ja compilado:
 *   node dist/workspace/backfill.js
 *
 * Nao e uma Prisma migration: apenas cria pastas sob WORKSPACES_ROOT.
 * Pode rodar multiplas vezes (idempotente).
 */
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { WorkspaceService } from './workspace.service';

async function main() {
  const logger = new Logger('WorkspaceBackfill');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });

  try {
    const prisma = app.get(PrismaService);
    const workspace = app.get(WorkspaceService);

    const users = await prisma.user.findMany({ select: { id: true, email: true } });
    logger.log(`Backfill em ${users.length} usuario(s)...`);

    let created = 0;
    for (const user of users) {
      try {
        await workspace.ensureUserRoot(user.id);
        created++;
      } catch (err) {
        logger.error(
          `Falhou para ${user.email} (${user.id}): ${(err as Error).message}`,
        );
      }
    }

    logger.log(`Concluido. Workspaces garantidos: ${created}/${users.length}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('Backfill falhou:', err);
  process.exit(1);
});
