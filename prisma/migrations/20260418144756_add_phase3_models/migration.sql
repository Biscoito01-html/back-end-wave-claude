-- CreateTable
CREATE TABLE "provider_profiles" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "base_url" TEXT,
    "encrypted_key" TEXT NOT NULL,
    "key_preview" TEXT NOT NULL,
    "default_model" TEXT,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "extra_headers" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "provider_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tool_permission_rules" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "tool_name" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tool_permission_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_servers" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "transport" TEXT NOT NULL,
    "command" TEXT,
    "args" JSONB,
    "url" TEXT,
    "env" JSONB,
    "headers" JSONB,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_servers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "provider_profiles_user_id_idx" ON "provider_profiles"("user_id");

-- CreateIndex
CREATE INDEX "tool_permission_rules_user_id_idx" ON "tool_permission_rules"("user_id");

-- CreateIndex
CREATE INDEX "tool_permission_rules_conversation_id_idx" ON "tool_permission_rules"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "tool_permission_rules_user_id_conversation_id_tool_name_key" ON "tool_permission_rules"("user_id", "conversation_id", "tool_name");

-- CreateIndex
CREATE INDEX "mcp_servers_user_id_idx" ON "mcp_servers"("user_id");
