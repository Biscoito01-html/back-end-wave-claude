-- CreateTable
CREATE TABLE "user_token_usage" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "model" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_token_usage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_token_usage_user_id_created_at_idx" ON "user_token_usage"("user_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "user_token_usage_conversation_id_idx" ON "user_token_usage"("conversation_id");

-- AddForeignKey
ALTER TABLE "user_token_usage" ADD CONSTRAINT "user_token_usage_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
