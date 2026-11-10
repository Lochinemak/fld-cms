-- AlterTable
ALTER TABLE "users" ADD COLUMN     "failed_sign_ins" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "locked_at" TIMESTAMPTZ(3);
