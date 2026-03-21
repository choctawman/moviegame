-- CreateEnum
CREATE TYPE "public"."DataPointStatus" AS ENUM ('SUCCESS', 'FAILED', 'MANUAL_OVERRIDE');

-- AlterTable
ALTER TABLE "public"."MovieSeasonStat" ADD COLUMN     "dataStatus" "public"."DataPointStatus" NOT NULL DEFAULT 'SUCCESS',
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "manualOverrideAt" TIMESTAMP(3),
ADD COLUMN     "manualOverrideByUserId" TEXT,
ADD COLUMN     "rawSource" JSONB;

-- AlterTable
ALTER TABLE "public"."MovieWeekStat" ADD COLUMN     "dataStatus" "public"."DataPointStatus" NOT NULL DEFAULT 'SUCCESS',
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "manualOverrideAt" TIMESTAMP(3),
ADD COLUMN     "manualOverrideByUserId" TEXT;
