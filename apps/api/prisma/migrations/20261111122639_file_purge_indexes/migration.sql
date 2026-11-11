-- CreateIndex
CREATE INDEX "file_folders_deleted_at_idx" ON "file_folders"("deleted_at");

-- CreateIndex
CREATE INDEX "files_tenant_id_updated_at_idx" ON "files"("tenant_id", "updated_at");

-- CreateIndex
CREATE INDEX "files_deleted_at_idx" ON "files"("deleted_at");
