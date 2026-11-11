-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "disabled_modules" TEXT[] DEFAULT ARRAY[]::TEXT[];
