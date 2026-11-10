-- CreateEnum
CREATE TYPE "customer_source" AS ENUM ('ONLINE', 'REFERRAL', 'EVENT', 'OUTBOUND', 'OTHER');

-- CreateEnum
CREATE TYPE "customer_level" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "customer_status" AS ENUM ('POTENTIAL', 'WON', 'LOST');

-- CreateEnum
CREATE TYPE "follow_up_method" AS ENUM ('CALL', 'VISIT', 'WECHAT', 'EMAIL', 'MEETING', 'OTHER');

-- CreateEnum
CREATE TYPE "opportunity_stage" AS ENUM ('QUALIFY', 'NEEDS', 'PROPOSAL', 'NEGOTIATION', 'WON', 'LOST');

-- CreateTable
CREATE TABLE "customers" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "industry" VARCHAR(64),
    "source" "customer_source",
    "level" "customer_level" NOT NULL DEFAULT 'B',
    "status" "customer_status" NOT NULL DEFAULT 'POTENTIAL',
    "phone" VARCHAR(32),
    "address" VARCHAR(255),
    "remark" VARCHAR(1000),
    "owner_id" BIGINT NOT NULL,
    "dept_id" BIGINT,
    "creator_id" BIGINT NOT NULL,
    "last_follow_up_at" TIMESTAMPTZ(3),
    "next_follow_up_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "name" VARCHAR(64) NOT NULL,
    "title" VARCHAR(64),
    "phone" VARCHAR(32),
    "email" VARCHAR(254),
    "is_primary" BOOLEAN NOT NULL DEFAULT false,
    "remark" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "follow_ups" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "contact_id" BIGINT,
    "opportunity_id" BIGINT,
    "method" "follow_up_method" NOT NULL,
    "content" VARCHAR(2000) NOT NULL,
    "followed_at" TIMESTAMPTZ(3) NOT NULL,
    "next_at" TIMESTAMPTZ(3),
    "author_id" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "follow_ups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "opportunities" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT NOT NULL,
    "customer_id" BIGINT NOT NULL,
    "name" VARCHAR(128) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "expected_close_date" DATE,
    "stage" "opportunity_stage" NOT NULL DEFAULT 'QUALIFY',
    "owner_id" BIGINT NOT NULL,
    "dept_id" BIGINT,
    "remark" VARCHAR(1000),
    "closed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "opportunities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_owner_id_idx" ON "customers"("owner_id");

-- CreateIndex
CREATE INDEX "customers_dept_id_idx" ON "customers"("dept_id");

-- CreateIndex
CREATE INDEX "customers_creator_id_idx" ON "customers"("creator_id");

-- CreateIndex
CREATE INDEX "customers_tenant_id_next_follow_up_at_idx" ON "customers"("tenant_id", "next_follow_up_at");

-- CreateIndex
CREATE UNIQUE INDEX "customers_tenant_id_id_key" ON "customers"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "contacts_tenant_id_customer_id_idx" ON "contacts"("tenant_id", "customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_tenant_id_id_key" ON "contacts"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "follow_ups_tenant_id_customer_id_followed_at_idx" ON "follow_ups"("tenant_id", "customer_id", "followed_at");

-- CreateIndex
CREATE INDEX "follow_ups_contact_id_idx" ON "follow_ups"("contact_id");

-- CreateIndex
CREATE INDEX "follow_ups_opportunity_id_idx" ON "follow_ups"("opportunity_id");

-- CreateIndex
CREATE INDEX "follow_ups_author_id_idx" ON "follow_ups"("author_id");

-- CreateIndex
CREATE UNIQUE INDEX "follow_ups_tenant_id_id_key" ON "follow_ups"("tenant_id", "id");

-- CreateIndex
CREATE INDEX "opportunities_tenant_id_customer_id_idx" ON "opportunities"("tenant_id", "customer_id");

-- CreateIndex
CREATE INDEX "opportunities_owner_id_idx" ON "opportunities"("owner_id");

-- CreateIndex
CREATE INDEX "opportunities_dept_id_idx" ON "opportunities"("dept_id");

-- CreateIndex
CREATE UNIQUE INDEX "opportunities_tenant_id_id_key" ON "opportunities"("tenant_id", "id");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_creator_id_fkey" FOREIGN KEY ("creator_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_dept_id_fkey" FOREIGN KEY ("dept_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_opportunity_id_fkey" FOREIGN KEY ("opportunity_id") REFERENCES "opportunities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "follow_ups" ADD CONSTRAINT "follow_ups_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_tenant_id_customer_id_fkey" FOREIGN KEY ("tenant_id", "customer_id") REFERENCES "customers"("tenant_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "opportunities" ADD CONSTRAINT "opportunities_dept_id_fkey" FOREIGN KEY ("dept_id") REFERENCES "departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
