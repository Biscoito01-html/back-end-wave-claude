-- DropIndex
DROP INDEX "tool_permission_rules_user_id_conversation_id_tool_name_key";

-- CreateIndex
CREATE INDEX "tool_permission_rules_user_id_conversation_id_tool_name_idx" ON "tool_permission_rules"("user_id", "conversation_id", "tool_name");
