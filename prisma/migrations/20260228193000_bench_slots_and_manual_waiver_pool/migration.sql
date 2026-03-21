-- AlterEnum
ALTER TYPE "public"."FantasyRole" ADD VALUE 'BENCH';

-- CreateTable
CREATE TABLE "public"."WaiverNomination" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "nominatingTeamId" TEXT NOT NULL,
    "fantasyPlayerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaiverNomination_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WaiverNomination_leagueId_weekId_idx" ON "public"."WaiverNomination"("leagueId", "weekId");

-- CreateIndex
CREATE INDEX "WaiverNomination_leagueId_weekId_fantasyPlayerId_idx" ON "public"."WaiverNomination"("leagueId", "weekId", "fantasyPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "WaiverNomination_leagueId_weekId_nominatingTeamId_key" ON "public"."WaiverNomination"("leagueId", "weekId", "nominatingTeamId");

-- AddForeignKey
ALTER TABLE "public"."WaiverNomination" ADD CONSTRAINT "WaiverNomination_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverNomination" ADD CONSTRAINT "WaiverNomination_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "public"."Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverNomination" ADD CONSTRAINT "WaiverNomination_nominatingTeamId_fkey" FOREIGN KEY ("nominatingTeamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverNomination" ADD CONSTRAINT "WaiverNomination_fantasyPlayerId_fkey" FOREIGN KEY ("fantasyPlayerId") REFERENCES "public"."FantasyPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
