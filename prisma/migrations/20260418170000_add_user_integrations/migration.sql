-- CreateTable
CREATE TABLE "user_integrations" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "token_encrypted" TEXT NOT NULL,
    "account_login" TEXT,
    "account_name" TEXT,
    "account_avatar" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_integrations_user_id_idx" ON "user_integrations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_integrations_user_id_provider_key" ON "user_integrations"("user_id", "provider");
