-- CreateTable
CREATE TABLE "context_notes" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL DEFAULT '',
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "project_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "context_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "context_notes_user_id_updated_at_idx" ON "context_notes"("user_id", "updated_at" DESC);
