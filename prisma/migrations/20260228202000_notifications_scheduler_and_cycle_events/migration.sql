-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('WAIVER_POOL_PUBLISHED', 'WAIVERS_PROCESSED', 'MATCHUP_SUMMARY');

-- CreateEnum
CREATE TYPE "public"."LeagueEventType" AS ENUM ('NOMINATION_PROCESS', 'WAIVER_PROCESS', 'MATCHUP_FINALIZE');

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "leagueId" TEXT,
    "type" "public"."NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "readAt" TIMESTAMP(3),

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeagueEventRun" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "eventType" "public"."LeagueEventType" NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "LeagueEventRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "public"."Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_leagueId_createdAt_idx" ON "public"."Notification"("leagueId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueEventRun_leagueId_weekId_eventType_key" ON "public"."LeagueEventRun"("leagueId", "weekId", "eventType");

-- CreateIndex
CREATE INDEX "LeagueEventRun_weekId_eventType_idx" ON "public"."LeagueEventRun"("weekId", "eventType");

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueEventRun" ADD CONSTRAINT "LeagueEventRun_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueEventRun" ADD CONSTRAINT "LeagueEventRun_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "public"."Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;
