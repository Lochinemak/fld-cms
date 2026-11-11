-- CreateTable
CREATE TABLE "user_totp" (
    "user_id" TEXT NOT NULL,
    "secret" VARCHAR(512) NOT NULL,
    "confirmed" BOOLEAN NOT NULL,
    "pending_secret" VARCHAR(512),
    "last_used_step" BIGINT,
    "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_totp_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "user_id" TEXT NOT NULL,
    "hash" VARCHAR(255) NOT NULL,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("user_id","hash")
);
