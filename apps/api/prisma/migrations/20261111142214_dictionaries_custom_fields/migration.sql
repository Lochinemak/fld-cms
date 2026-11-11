-- CreateEnum
CREATE TYPE "custom_field_type" AS ENUM ('TEXT', 'TEXTAREA', 'NUMBER', 'DATE', 'SELECT', 'MULTI_SELECT', 'BOOLEAN');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "custom" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "custom" JSONB NOT NULL DEFAULT '{}';

-- The customer's source becomes a value of the tenant's crm.customer-source dictionary, whose
-- built-in items keep the enum's values: the column changes type, its values stay.
ALTER TABLE "customers" ALTER COLUMN "source" TYPE VARCHAR(64) USING "source"::text;

-- DropEnum
DROP TYPE "customer_source";

-- CreateTable
CREATE TABLE "dictionaries" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "code" VARCHAR(64) NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "builtin" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dictionaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dictionary_items" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "dictionary_id" BIGINT NOT NULL,
    "value" VARCHAR(64) NOT NULL,
    "label" VARCHAR(64) NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "dictionary_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "custom_fields" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "entity" VARCHAR(64) NOT NULL,
    "key" VARCHAR(64) NOT NULL,
    "label" VARCHAR(64) NOT NULL,
    "type" "custom_field_type" NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "show_in_list" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "dictionary_id" BIGINT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "custom_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "dictionaries_tenant_id_id_key" ON "dictionaries"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "dictionaries_tenant_id_code_key" ON "dictionaries"("tenant_id", "code");

-- CreateIndex
CREATE INDEX "dictionary_items_tenant_id_dictionary_id_idx" ON "dictionary_items"("tenant_id", "dictionary_id");

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_items_tenant_id_id_key" ON "dictionary_items"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "dictionary_items_dictionary_id_value_key" ON "dictionary_items"("dictionary_id", "value");

-- CreateIndex
CREATE UNIQUE INDEX "custom_fields_tenant_id_id_key" ON "custom_fields"("tenant_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "custom_fields_tenant_id_entity_key_key" ON "custom_fields"("tenant_id", "entity", "key");

-- AddForeignKey
ALTER TABLE "dictionaries" ADD CONSTRAINT "dictionaries_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dictionary_items" ADD CONSTRAINT "dictionary_items_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dictionary_items" ADD CONSTRAINT "dictionary_items_tenant_id_dictionary_id_fkey" FOREIGN KEY ("tenant_id", "dictionary_id") REFERENCES "dictionaries"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "custom_fields" ADD CONSTRAINT "custom_fields_tenant_id_dictionary_id_fkey" FOREIGN KEY ("tenant_id", "dictionary_id") REFERENCES "dictionaries"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
