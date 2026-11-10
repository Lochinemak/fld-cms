-- CreateEnum
CREATE TYPE "file_ref_target" AS ENUM ('CUSTOMER');

-- CreateTable
CREATE TABLE "file_folders" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "parent_id" BIGINT,
    "name" VARCHAR(100) NOT NULL,
    "owner_id" BIGINT NOT NULL,
    "dept_id" BIGINT,
    "creator_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "file_folders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "folder_id" BIGINT,
    "name" VARCHAR(255) NOT NULL,
    "version" INTEGER NOT NULL,
    "storage_key" VARCHAR(255) NOT NULL,
    "size" BIGINT NOT NULL,
    "mime_type" VARCHAR(127) NOT NULL,
    "owner_id" BIGINT NOT NULL,
    "dept_id" BIGINT,
    "creator_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_versions" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "file_id" BIGINT NOT NULL,
    "number" INTEGER NOT NULL,
    "storage_key" VARCHAR(255) NOT NULL,
    "size" BIGINT NOT NULL,
    "mime_type" VARCHAR(127) NOT NULL,
    "uploader_id" BIGINT NOT NULL,
    "restored_from" INTEGER,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_shares" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "file_id" BIGINT NOT NULL,
    "token" VARCHAR(64) NOT NULL,
    "code" VARCHAR(8),
    "expires_at" TIMESTAMPTZ(3),
    "access_count" INTEGER NOT NULL DEFAULT 0,
    "last_accessed_at" TIMESTAMPTZ(3),
    "creator_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "file_refs" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "file_id" BIGINT NOT NULL,
    "target_type" "file_ref_target" NOT NULL,
    "target_id" BIGINT NOT NULL,
    "creator_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "file_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "file_folders_tenant_id_parent_id_idx" ON "file_folders"("tenant_id", "parent_id");

-- CreateIndex
CREATE INDEX "file_folders_owner_id_idx" ON "file_folders"("owner_id");

-- CreateIndex
CREATE INDEX "file_folders_dept_id_idx" ON "file_folders"("dept_id");

-- CreateIndex
CREATE INDEX "file_folders_creator_id_idx" ON "file_folders"("creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_folders_tenant_id_id_key" ON "file_folders"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "files_tenant_id_folder_id_idx" ON "files"("tenant_id", "folder_id");

-- CreateIndex
CREATE INDEX "files_owner_id_idx" ON "files"("owner_id");

-- CreateIndex
CREATE INDEX "files_dept_id_idx" ON "files"("dept_id");

-- CreateIndex
CREATE INDEX "files_creator_id_idx" ON "files"("creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "files_tenant_id_id_key" ON "files"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "file_versions_tenant_id_file_id_idx" ON "file_versions"("tenant_id", "file_id");

-- CreateIndex
CREATE INDEX "file_versions_uploader_id_idx" ON "file_versions"("uploader_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_versions_tenant_id_id_key" ON "file_versions"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "file_versions_file_id_number_key" ON "file_versions"("file_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "file_shares_token_key" ON "file_shares"("token");

-- CreateIndex
CREATE INDEX "file_shares_tenant_id_file_id_idx" ON "file_shares"("tenant_id", "file_id");

-- CreateIndex
CREATE INDEX "file_shares_creator_id_idx" ON "file_shares"("creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_shares_tenant_id_id_key" ON "file_shares"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "file_refs_tenant_id_target_type_target_id_idx" ON "file_refs"("tenant_id", "target_type", "target_id");

-- CreateIndex
CREATE INDEX "file_refs_creator_id_idx" ON "file_refs"("creator_id");

-- CreateIndex
CREATE UNIQUE INDEX "file_refs_tenant_id_id_key" ON "file_refs"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "file_refs_file_id_target_type_target_id_key" ON "file_refs"("file_id", "target_type", "target_id");

-- AddForeignKey
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_tenant_id_parent_id_fkey" FOREIGN KEY ("tenant_id", "parent_id") REFERENCES "file_folders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_folders" ADD CONSTRAINT "file_folders_dept_id_fkey" FOREIGN KEY ("dept_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_tenant_id_folder_id_fkey" FOREIGN KEY ("tenant_id", "folder_id") REFERENCES "file_folders"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_dept_id_fkey" FOREIGN KEY ("dept_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_tenant_id_file_id_fkey" FOREIGN KEY ("tenant_id", "file_id") REFERENCES "files"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_versions" ADD CONSTRAINT "file_versions_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_tenant_id_file_id_fkey" FOREIGN KEY ("tenant_id", "file_id") REFERENCES "files"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_shares" ADD CONSTRAINT "file_shares_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_refs" ADD CONSTRAINT "file_refs_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_refs" ADD CONSTRAINT "file_refs_tenant_id_file_id_fkey" FOREIGN KEY ("tenant_id", "file_id") REFERENCES "files"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "file_refs" ADD CONSTRAINT "file_refs_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
