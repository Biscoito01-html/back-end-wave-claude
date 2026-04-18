/**
 * Smoke test do WorkspaceService (sem DB, apenas I/O de disco).
 * Roda standalone:
 *   npx ts-node src/workspace/workspace.smoke-test.ts
 *
 * Cobre os 6 cenarios do plano que sao testaveis sem UI:
 *   1. criacao (ensureUserRoot cria pasta + meta)
 *   2. isolamento (dois user roots nao se sobrepoem)
 *   3. traversal 403 (resolveForUser rejeita ../outro)
 *   4. delete (removeUserRoot apaga)
 *   5. reboot (meta file persiste entre chamadas)
 *   6. override (WORKSPACES_ROOT via env aplicado)
 */
import { promises as fs } from 'fs';
import * as path from 'path';
import * as os from 'os';
import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WorkspaceService } from './workspace.service';

class FakePrisma {
  globalSetting = {
    findUnique: async () => null as any,
  };
}

function assert(condition: unknown, message: string) {
  if (!condition) {
    console.error(`  ✗ ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`  ✓ ${message}`);
  }
}

async function expectThrow(fn: () => Promise<unknown>, message: string) {
  try {
    await fn();
    console.error(`  ✗ ${message} (nao lancou)`);
    process.exitCode = 1;
  } catch (err) {
    if (err instanceof ForbiddenException) {
      console.log(`  ✓ ${message}`);
    } else {
      console.error(`  ✗ ${message} (lancou tipo errado: ${(err as Error).message})`);
      process.exitCode = 1;
    }
  }
}

async function main() {
  const tmpRoot = path.join(os.tmpdir(), `openclaude-ws-test-${Date.now()}`);
  process.env.WORKSPACES_ROOT = tmpRoot;

  const config = new ConfigService();
  const prisma = new FakePrisma() as any;
  const svc = new WorkspaceService(config, prisma);

  console.log(`\n[1] Criacao de workspace (root=${tmpRoot})`);
  const rootA = await svc.ensureUserRoot('user-a');
  const rootB = await svc.ensureUserRoot('user-b');
  assert((await fs.stat(rootA)).isDirectory(), 'user-a pasta existe');
  assert((await fs.stat(rootB)).isDirectory(), 'user-b pasta existe');
  const metaA = JSON.parse(
    await fs.readFile(path.join(rootA, '.workspace-meta.json'), 'utf8'),
  );
  assert(metaA.userId === 'user-a', 'meta contem userId');

  console.log('\n[2] Isolamento entre usuarios');
  assert(rootA !== rootB, 'roots diferentes');
  assert(
    !rootA.startsWith(rootB + path.sep) && !rootB.startsWith(rootA + path.sep),
    'nenhum root esta contido no outro',
  );

  console.log('\n[3] Traversal 403');
  await expectThrow(
    () => svc.resolveForUser('user-a', '../user-b'),
    'rejeita ../user-b',
  );
  await expectThrow(
    () => svc.resolveForUser('user-a', '../../etc/passwd'),
    'rejeita ../../etc/passwd',
  );
  await expectThrow(
    () => svc.resolveForUser('user-a', path.resolve(tmpRoot, 'user-b')),
    'rejeita path absoluto fora do proprio root',
  );
  const resolved = await svc.resolveForUser('user-a', 'projects/foo');
  assert(
    resolved === path.join(rootA, 'projects', 'foo'),
    'aceita subpath valido projects/foo',
  );
  const resolvedRoot = await svc.resolveForUser('user-a', null);
  assert(resolvedRoot === rootA, 'null retorna o proprio root');

  console.log('\n[4] Delete');
  await svc.removeUserRoot('user-a');
  let existsAfter = true;
  try {
    await fs.stat(rootA);
  } catch {
    existsAfter = false;
  }
  assert(!existsAfter, 'rootA removido do disco');
  // user-b permanece
  assert((await fs.stat(rootB)).isDirectory(), 'user-b preservado');

  console.log('\n[5] Idempotencia + "reboot"');
  const rootB2 = await svc.ensureUserRoot('user-b');
  assert(rootB2 === rootB, 'ensureUserRoot reutiliza pasta existente');
  const svc2 = new WorkspaceService(config, prisma);
  const rootB3 = await svc2.ensureUserRoot('user-b');
  assert(
    rootB3 === rootB,
    'instancia nova apos "reboot" enxerga a pasta existente',
  );

  console.log('\n[6] Override via env');
  const overrideRoot = path.join(os.tmpdir(), `openclaude-ws-test-override-${Date.now()}`);
  process.env.WORKSPACES_ROOT = overrideRoot;
  const svc3 = new WorkspaceService(new ConfigService(), prisma);
  const overrideUserRoot = await svc3.ensureUserRoot('user-c');
  assert(
    overrideUserRoot.startsWith(overrideRoot),
    'novo WORKSPACES_ROOT aplicado',
  );

  // cleanup
  await fs.rm(tmpRoot, { recursive: true, force: true });
  await fs.rm(overrideRoot, { recursive: true, force: true });

  if (process.exitCode) {
    console.log('\n❌ Smoke test FALHOU');
  } else {
    console.log('\n✅ Smoke test OK');
  }
}

main().catch((err) => {
  console.error('Erro inesperado no smoke test:', err);
  process.exit(1);
});
