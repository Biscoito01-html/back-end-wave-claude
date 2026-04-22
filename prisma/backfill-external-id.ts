/**
 * Backfill de externalId para usuarios ja existentes no banco do OpenClaude.
 *
 * Contexto: apos a migration `add_external_id_to_users`, usuarios antigos
 * ficam sem `external_id`. Quando um JWT do gateway chega, a JwtStrategy
 * tenta encontrar o user por `externalId` (= payload.sub). Se nao encontrar,
 * tenta casar pelo `email`; se casar, atualiza o `externalId` e reaproveita.
 *
 * Este script automatiza esse "match por email" de forma batch: recebe um
 * mapping manual de email -> externalId (uuid do control-panel) e faz o
 * update. Serve para preparar o banco antes de colocar o JIT no ar, evitando
 * disputa de `email @unique` no primeiro login.
 *
 * Como obter o `externalId` (sub) de cada usuario:
 *   - No control-panel, logar como aquele usuario e chamar GET /auth/me — o
 *     campo `id` no response e o sub do JWT.
 *   - Ou consultar direto o banco do gateway: `SELECT id, email FROM users`.
 *
 * Execucao:
 *   cd back-end/openclaude
 *   npx tsx prisma/backfill-external-id.ts
 *
 * Se nao houver usuarios reais no banco do OpenClaude (banco novo), este
 * script pode ser ignorado — a JwtStrategy cria tudo on-the-fly.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Preencher com o mapping real antes de executar em producao.
 * Chave: email usado hoje no OpenClaude.
 * Valor: sub (uuid) do control-panel.
 */
const mapping: Record<string, string> = {
  // 'rochaneto@groupwave.global': '00000000-0000-0000-0000-000000000000',
};

async function main() {
  const entries = Object.entries(mapping);
  if (entries.length === 0) {
    console.log(
      '[backfill] Nenhum mapping configurado. Edite prisma/backfill-external-id.ts e preencha `mapping`.',
    );
    return;
  }

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const [email, externalId] of entries) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      console.warn(`[backfill] Usuario com email=${email} nao encontrado.`);
      notFound++;
      continue;
    }
    if (user.externalId === externalId) {
      console.log(`[backfill] ${email} ja esta com externalId correto.`);
      skipped++;
      continue;
    }
    if (user.externalId && user.externalId !== externalId) {
      console.warn(
        `[backfill] ${email} ja possui externalId=${user.externalId} diferente do mapping (${externalId}). Pulando por seguranca.`,
      );
      skipped++;
      continue;
    }
    await prisma.user.update({ where: { id: user.id }, data: { externalId } });
    console.log(`[backfill] ${email} => ${externalId}`);
    updated++;
  }

  console.log(
    `[backfill] done. updated=${updated} skipped=${skipped} notFound=${notFound}`,
  );
}

main()
  .catch((e) => {
    console.error('[backfill] erro:', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
