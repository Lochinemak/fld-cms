-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGINT NOT NULL,
    "tenant_id" BIGINT,
    "account_id" BIGINT,
    "actor_id" BIGINT,
    "actor_username" VARCHAR(254),
    "actor_name" VARCHAR(64),
    "action" VARCHAR(64) NOT NULL,
    "target_type" VARCHAR(32),
    "target_id" BIGINT,
    "target_name" VARCHAR(255),
    "success" BOOLEAN NOT NULL,
    "reason" VARCHAR(255),
    "changes" JSONB,
    "ip" VARCHAR(64),
    "user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "audit_logs_tenant_id_created_at_idx" ON "audit_logs"("tenant_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_account_id_created_at_idx" ON "audit_logs"("account_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at");
