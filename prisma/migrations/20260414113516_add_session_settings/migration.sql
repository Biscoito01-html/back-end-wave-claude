-- AlterTable
ALTER TABLE "chat_sessions" ADD COLUMN     "allowed_tools" JSONB,
ADD COLUMN     "max_turns" INTEGER,
ADD COLUMN     "system_prompt" TEXT;
