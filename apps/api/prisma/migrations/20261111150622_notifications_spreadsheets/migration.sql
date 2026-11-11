-- CreateEnum
CREATE TYPE "spreadsheet_task_kind" AS ENUM ('EXPORT', 'IMPORT');

-- CreateEnum
CREATE TYPE "spreadsheet_task_status" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "notifications" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "kind" VARCHAR(32) NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "body" VARCHAR(1000),
    "link" VARCHAR(500),
    "read_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "spreadsheet_tasks" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "user_id" BIGINT NOT NULL,
    "kind" "spreadsheet_task_kind" NOT NULL,
    "entity" VARCHAR(64) NOT NULL,
    "status" "spreadsheet_task_status" NOT NULL DEFAULT 'PENDING',
    "file_name" VARCHAR(255) NOT NULL,
    "storage_key" VARCHAR(255),
    "file_size" BIGINT,
    "query" JSONB,
    "row_count" INTEGER,
    "error" VARCHAR(1000),
    "row_errors" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "spreadsheet_tasks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_tenant_id_user_id_created_at_idx" ON "notifications"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "notifications_created_at_idx" ON "notifications"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenant_id_id_key" ON "notifications"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "spreadsheet_tasks_tenant_id_user_id_created_at_idx" ON "spreadsheet_tasks"("tenant_id", "user_id", "created_at");

-- CreateIndex
CREATE INDEX "spreadsheet_tasks_created_at_idx" ON "spreadsheet_tasks"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "spreadsheet_tasks_tenant_id_id_key" ON "spreadsheet_tasks"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spreadsheet_tasks" ADD CONSTRAINT "spreadsheet_tasks_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spreadsheet_tasks" ADD CONSTRAINT "spreadsheet_tasks_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
