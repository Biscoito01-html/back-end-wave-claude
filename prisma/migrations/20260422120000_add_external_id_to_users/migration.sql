-- AlterTable
ALTER TABLE "users" ADD COLUMN "external_id" TEXT;

-- AlterTable: permite que usuarios criados via JIT provisioning (vindos do
-- gateway de autenticacao) nao precisem de password_hash local.
ALTER TABLE "users" ALTER COLUMN "password_hash" DROP NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "users_external_id_key" ON "users"("external_id");
