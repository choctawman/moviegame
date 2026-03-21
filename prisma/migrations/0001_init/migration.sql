-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."LeagueStatus" AS ENUM ('PRE_DRAFT', 'DRAFTING', 'IN_SEASON', 'COMPLETE');

-- CreateEnum
CREATE TYPE "public"."MemberRole" AS ENUM ('COMMISSIONER', 'PLAYER');

-- CreateEnum
CREATE TYPE "public"."DraftType" AS ENUM ('SNAKE', 'AUCTION');

-- CreateEnum
CREATE TYPE "public"."DraftStatus" AS ENUM ('NOT_STARTED', 'LIVE', 'PAUSED', 'COMPLETE');

-- CreateEnum
CREATE TYPE "public"."FantasyRole" AS ENUM ('LEADING_ACTOR', 'LEADING_ACTRESS', 'SUPPORTING', 'DIRECTOR', 'PRODUCER');

-- CreateEnum
CREATE TYPE "public"."CreditType" AS ENUM ('CAST', 'CREW');

-- CreateEnum
CREATE TYPE "public"."MatchupResult" AS ENUM ('HOME_WIN', 'AWAY_WIN', 'TIE');

-- CreateEnum
CREATE TYPE "public"."WaiverClaimStatus" AS ENUM ('PENDING', 'WON', 'LOST', 'INVALID');

-- CreateEnum
CREATE TYPE "public"."TransactionType" AS ENUM ('ADD', 'DROP', 'WAIVER_ADD', 'WAIVER_DROP', 'TRADE');

-- CreateEnum
CREATE TYPE "public"."TradeStatus" AS ENUM ('PROPOSED', 'ACCEPTED', 'REJECTED', 'CANCELED', 'VETOED', 'COMPLETED');

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "isCommissioner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."League" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "commissionerUserId" TEXT NOT NULL,
    "status" "public"."LeagueStatus" NOT NULL DEFAULT 'PRE_DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "League_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeagueInvite" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "usedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "LeagueInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeagueMember" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "teamId" TEXT,
    "role" "public"."MemberRole" NOT NULL,

    CONSTRAINT "LeagueMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Team" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "recordWins" INTEGER NOT NULL DEFAULT 0,
    "recordLosses" INTEGER NOT NULL DEFAULT 0,
    "recordTies" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."LeagueSettings" (
    "leagueId" TEXT NOT NULL,
    "draftType" "public"."DraftType" NOT NULL DEFAULT 'SNAKE',
    "auctionBudget" INTEGER NOT NULL DEFAULT 200,
    "pickTimerSeconds" INTEGER NOT NULL DEFAULT 180,
    "waiverProcessDow" INTEGER NOT NULL DEFAULT 3,
    "waiverProcessLocalTime" TEXT NOT NULL DEFAULT '09:00',
    "freeAgencyLockStartDow" INTEGER NOT NULL DEFAULT 1,
    "freeAgencyLockStartLocalTime" TEXT NOT NULL DEFAULT '00:00',
    "tradeReviewEnabled" BOOLEAN NOT NULL DEFAULT false,
    "tradeReviewHours" INTEGER NOT NULL DEFAULT 24,
    "keepersEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "LeagueSettings_pkey" PRIMARY KEY ("leagueId")
);

-- CreateTable
CREATE TABLE "public"."Week" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Week_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Matchup" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "homeTeamId" TEXT NOT NULL,
    "awayTeamId" TEXT NOT NULL,
    "homeScoreTotal" DECIMAL(10,2),
    "awayScoreTotal" DECIMAL(10,2),
    "homeRtAvg" DECIMAL(5,2),
    "awayRtAvg" DECIMAL(5,2),
    "result" "public"."MatchupResult",
    "finalizedAt" TIMESTAMP(3),

    CONSTRAINT "Matchup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Person" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "gender" INTEGER,
    "externalTmdbPersonId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FantasyPlayer" (
    "id" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "role" "public"."FantasyRole" NOT NULL,

    CONSTRAINT "FantasyPlayer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RosterSlot" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "role" "public"."FantasyRole" NOT NULL,
    "slotIndex" INTEGER NOT NULL,
    "fantasyPlayerId" TEXT,

    CONSTRAINT "RosterSlot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Movie" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "externalTmdbMovieId" INTEGER,
    "theatricalReleaseDate" TIMESTAMP(3),
    "seasonYear" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Movie_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Credit" (
    "id" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "creditType" "public"."CreditType" NOT NULL,
    "billingOrder" INTEGER,
    "job" TEXT,
    "department" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Credit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."MovieWeekStat" (
    "id" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "worldwideGrossUsd" BIGINT NOT NULL DEFAULT 0,
    "rtCriticsScore" INTEGER,
    "rtAudienceScore" INTEGER,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawSource" JSONB,

    CONSTRAINT "MovieWeekStat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."FantasyPlayerWeekScore" (
    "id" TEXT NOT NULL,
    "fantasyPlayerId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "pointsBoxOffice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pointsRt" INTEGER NOT NULL DEFAULT 0,
    "rtContribCount" INTEGER NOT NULL DEFAULT 0,
    "breakdown" JSONB,

    CONSTRAINT "FantasyPlayerWeekScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TeamWeekScore" (
    "id" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "pointsTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pointsBoxOffice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pointsRt" INTEGER NOT NULL DEFAULT 0,
    "rtAvg" DECIMAL(5,2) NOT NULL DEFAULT 0,

    CONSTRAINT "TeamWeekScore_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Draft" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "type" "public"."DraftType" NOT NULL,
    "status" "public"."DraftStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Draft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."DraftPick" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "overallPick" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "teamId" TEXT NOT NULL,
    "fantasyPlayerId" TEXT NOT NULL,
    "pickedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "autoPicked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DraftPick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuctionNomination" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "nominatingTeamId" TEXT NOT NULL,
    "fantasyPlayerId" TEXT NOT NULL,
    "nominatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionNomination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuctionBid" (
    "id" TEXT NOT NULL,
    "nominationId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "bidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuctionBid_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."WaiverPriority" (
    "leagueId" TEXT NOT NULL,
    "orderedTeamIds" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaiverPriority_pkey" PRIMARY KEY ("leagueId")
);

-- CreateTable
CREATE TABLE "public"."WaiverClaim" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "weekId" TEXT NOT NULL,
    "teamId" TEXT NOT NULL,
    "priorityIndex" INTEGER NOT NULL,
    "addFantasyPlayerId" TEXT NOT NULL,
    "dropRosterSlotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "public"."WaiverClaimStatus" NOT NULL DEFAULT 'PENDING',
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "WaiverClaim_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Transaction" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "weekId" TEXT,
    "type" "public"."TransactionType" NOT NULL,
    "teamId" TEXT NOT NULL,
    "fantasyPlayerId" TEXT NOT NULL,
    "rosterSlotId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,

    CONSTRAINT "Transaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Trade" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "proposerTeamId" TEXT NOT NULL,
    "recipientTeamId" TEXT NOT NULL,
    "status" "public"."TradeStatus" NOT NULL DEFAULT 'PROPOSED',
    "reviewEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TradeItem" (
    "id" TEXT NOT NULL,
    "tradeId" TEXT NOT NULL,
    "fromTeamId" TEXT NOT NULL,
    "fantasyPlayerId" TEXT NOT NULL,
    "rosterSlotRole" "public"."FantasyRole" NOT NULL,
    "rosterSlotIndex" INTEGER NOT NULL,

    CONSTRAINT "TradeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ProviderStatus" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "lastSuccessAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastErrorMessage" TEXT,

    CONSTRAINT "ProviderStatus_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "public"."Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "public"."Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "public"."Session"("expiresAt");

-- CreateIndex
CREATE INDEX "League_commissionerUserId_idx" ON "public"."League"("commissionerUserId");

-- CreateIndex
CREATE INDEX "League_seasonYear_idx" ON "public"."League"("seasonYear");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueInvite_tokenHash_key" ON "public"."LeagueInvite"("tokenHash");

-- CreateIndex
CREATE INDEX "LeagueInvite_leagueId_idx" ON "public"."LeagueInvite"("leagueId");

-- CreateIndex
CREATE INDEX "LeagueInvite_expiresAt_idx" ON "public"."LeagueInvite"("expiresAt");

-- CreateIndex
CREATE INDEX "LeagueMember_leagueId_idx" ON "public"."LeagueMember"("leagueId");

-- CreateIndex
CREATE INDEX "LeagueMember_userId_idx" ON "public"."LeagueMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMember_leagueId_userId_key" ON "public"."LeagueMember"("leagueId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueMember_leagueId_teamId_key" ON "public"."LeagueMember"("leagueId", "teamId");

-- CreateIndex
CREATE INDEX "Team_leagueId_idx" ON "public"."Team"("leagueId");

-- CreateIndex
CREATE INDEX "Team_ownerUserId_idx" ON "public"."Team"("ownerUserId");

-- CreateIndex
CREATE INDEX "Week_leagueId_startAt_endAt_idx" ON "public"."Week"("leagueId", "startAt", "endAt");

-- CreateIndex
CREATE UNIQUE INDEX "Week_leagueId_index_key" ON "public"."Week"("leagueId", "index");

-- CreateIndex
CREATE INDEX "Matchup_leagueId_weekId_idx" ON "public"."Matchup"("leagueId", "weekId");

-- CreateIndex
CREATE INDEX "Matchup_homeTeamId_idx" ON "public"."Matchup"("homeTeamId");

-- CreateIndex
CREATE INDEX "Matchup_awayTeamId_idx" ON "public"."Matchup"("awayTeamId");

-- CreateIndex
CREATE UNIQUE INDEX "Person_externalTmdbPersonId_key" ON "public"."Person"("externalTmdbPersonId");

-- CreateIndex
CREATE INDEX "Person_name_idx" ON "public"."Person"("name");

-- CreateIndex
CREATE INDEX "FantasyPlayer_role_idx" ON "public"."FantasyPlayer"("role");

-- CreateIndex
CREATE UNIQUE INDEX "FantasyPlayer_personId_role_key" ON "public"."FantasyPlayer"("personId", "role");

-- CreateIndex
CREATE INDEX "RosterSlot_teamId_idx" ON "public"."RosterSlot"("teamId");

-- CreateIndex
CREATE INDEX "RosterSlot_fantasyPlayerId_idx" ON "public"."RosterSlot"("fantasyPlayerId");

-- CreateIndex
CREATE UNIQUE INDEX "RosterSlot_teamId_role_slotIndex_key" ON "public"."RosterSlot"("teamId", "role", "slotIndex");

-- CreateIndex
CREATE UNIQUE INDEX "Movie_externalTmdbMovieId_key" ON "public"."Movie"("externalTmdbMovieId");

-- CreateIndex
CREATE INDEX "Movie_seasonYear_idx" ON "public"."Movie"("seasonYear");

-- CreateIndex
CREATE INDEX "Movie_theatricalReleaseDate_idx" ON "public"."Movie"("theatricalReleaseDate");

-- CreateIndex
CREATE INDEX "Credit_movieId_creditType_billingOrder_idx" ON "public"."Credit"("movieId", "creditType", "billingOrder");

-- CreateIndex
CREATE INDEX "Credit_personId_idx" ON "public"."Credit"("personId");

-- CreateIndex
CREATE INDEX "Credit_job_idx" ON "public"."Credit"("job");

-- CreateIndex
CREATE INDEX "MovieWeekStat_leagueId_weekId_idx" ON "public"."MovieWeekStat"("leagueId", "weekId");

-- CreateIndex
CREATE UNIQUE INDEX "MovieWeekStat_movieId_leagueId_weekId_key" ON "public"."MovieWeekStat"("movieId", "leagueId", "weekId");

-- CreateIndex
CREATE INDEX "FantasyPlayerWeekScore_leagueId_weekId_idx" ON "public"."FantasyPlayerWeekScore"("leagueId", "weekId");

-- CreateIndex
CREATE UNIQUE INDEX "FantasyPlayerWeekScore_fantasyPlayerId_leagueId_weekId_key" ON "public"."FantasyPlayerWeekScore"("fantasyPlayerId", "leagueId", "weekId");

-- CreateIndex
CREATE INDEX "TeamWeekScore_leagueId_weekId_idx" ON "public"."TeamWeekScore"("leagueId", "weekId");

-- CreateIndex
CREATE UNIQUE INDEX "TeamWeekScore_teamId_leagueId_weekId_key" ON "public"."TeamWeekScore"("teamId", "leagueId", "weekId");

-- CreateIndex
CREATE UNIQUE INDEX "Draft_leagueId_key" ON "public"."Draft"("leagueId");

-- CreateIndex
CREATE INDEX "DraftPick_draftId_round_idx" ON "public"."DraftPick"("draftId", "round");

-- CreateIndex
CREATE UNIQUE INDEX "DraftPick_draftId_overallPick_key" ON "public"."DraftPick"("draftId", "overallPick");

-- CreateIndex
CREATE INDEX "AuctionNomination_draftId_nominatedAt_idx" ON "public"."AuctionNomination"("draftId", "nominatedAt");

-- CreateIndex
CREATE INDEX "AuctionBid_nominationId_bidAt_idx" ON "public"."AuctionBid"("nominationId", "bidAt");

-- CreateIndex
CREATE INDEX "WaiverClaim_leagueId_weekId_status_idx" ON "public"."WaiverClaim"("leagueId", "weekId", "status");

-- CreateIndex
CREATE INDEX "WaiverClaim_leagueId_addFantasyPlayerId_idx" ON "public"."WaiverClaim"("leagueId", "addFantasyPlayerId");

-- CreateIndex
CREATE INDEX "Transaction_leagueId_createdAt_idx" ON "public"."Transaction"("leagueId", "createdAt");

-- CreateIndex
CREATE INDEX "Transaction_teamId_createdAt_idx" ON "public"."Transaction"("teamId", "createdAt");

-- CreateIndex
CREATE INDEX "Trade_leagueId_status_idx" ON "public"."Trade"("leagueId", "status");

-- CreateIndex
CREATE INDEX "TradeItem_tradeId_idx" ON "public"."TradeItem"("tradeId");

-- CreateIndex
CREATE UNIQUE INDEX "ProviderStatus_leagueId_providerName_key" ON "public"."ProviderStatus"("leagueId", "providerName");

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."League" ADD CONSTRAINT "League_commissionerUserId_fkey" FOREIGN KEY ("commissionerUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueInvite" ADD CONSTRAINT "LeagueInvite_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueMember" ADD CONSTRAINT "LeagueMember_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueMember" ADD CONSTRAINT "LeagueMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueMember" ADD CONSTRAINT "LeagueMember_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Team" ADD CONSTRAINT "Team_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Team" ADD CONSTRAINT "Team_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "public"."User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueSettings" ADD CONSTRAINT "LeagueSettings_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Week" ADD CONSTRAINT "Week_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Matchup" ADD CONSTRAINT "Matchup_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Matchup" ADD CONSTRAINT "Matchup_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "public"."Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Matchup" ADD CONSTRAINT "Matchup_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Matchup" ADD CONSTRAINT "Matchup_awayTeamId_fkey" FOREIGN KEY ("awayTeamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FantasyPlayer" ADD CONSTRAINT "FantasyPlayer_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RosterSlot" ADD CONSTRAINT "RosterSlot_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RosterSlot" ADD CONSTRAINT "RosterSlot_fantasyPlayerId_fkey" FOREIGN KEY ("fantasyPlayerId") REFERENCES "public"."FantasyPlayer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Credit" ADD CONSTRAINT "Credit_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "public"."Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Credit" ADD CONSTRAINT "Credit_personId_fkey" FOREIGN KEY ("personId") REFERENCES "public"."Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MovieWeekStat" ADD CONSTRAINT "MovieWeekStat_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "public"."Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MovieWeekStat" ADD CONSTRAINT "MovieWeekStat_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."MovieWeekStat" ADD CONSTRAINT "MovieWeekStat_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "public"."Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FantasyPlayerWeekScore" ADD CONSTRAINT "FantasyPlayerWeekScore_fantasyPlayerId_fkey" FOREIGN KEY ("fantasyPlayerId") REFERENCES "public"."FantasyPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FantasyPlayerWeekScore" ADD CONSTRAINT "FantasyPlayerWeekScore_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."FantasyPlayerWeekScore" ADD CONSTRAINT "FantasyPlayerWeekScore_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "public"."Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TeamWeekScore" ADD CONSTRAINT "TeamWeekScore_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TeamWeekScore" ADD CONSTRAINT "TeamWeekScore_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TeamWeekScore" ADD CONSTRAINT "TeamWeekScore_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "public"."Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Draft" ADD CONSTRAINT "Draft_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DraftPick" ADD CONSTRAINT "DraftPick_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "public"."Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DraftPick" ADD CONSTRAINT "DraftPick_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."DraftPick" ADD CONSTRAINT "DraftPick_fantasyPlayerId_fkey" FOREIGN KEY ("fantasyPlayerId") REFERENCES "public"."FantasyPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuctionNomination" ADD CONSTRAINT "AuctionNomination_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "public"."Draft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuctionNomination" ADD CONSTRAINT "AuctionNomination_nominatingTeamId_fkey" FOREIGN KEY ("nominatingTeamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuctionNomination" ADD CONSTRAINT "AuctionNomination_fantasyPlayerId_fkey" FOREIGN KEY ("fantasyPlayerId") REFERENCES "public"."FantasyPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuctionBid" ADD CONSTRAINT "AuctionBid_nominationId_fkey" FOREIGN KEY ("nominationId") REFERENCES "public"."AuctionNomination"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuctionBid" ADD CONSTRAINT "AuctionBid_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverPriority" ADD CONSTRAINT "WaiverPriority_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverClaim" ADD CONSTRAINT "WaiverClaim_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverClaim" ADD CONSTRAINT "WaiverClaim_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "public"."Week"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverClaim" ADD CONSTRAINT "WaiverClaim_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverClaim" ADD CONSTRAINT "WaiverClaim_addFantasyPlayerId_fkey" FOREIGN KEY ("addFantasyPlayerId") REFERENCES "public"."FantasyPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."WaiverClaim" ADD CONSTRAINT "WaiverClaim_dropRosterSlotId_fkey" FOREIGN KEY ("dropRosterSlotId") REFERENCES "public"."RosterSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_weekId_fkey" FOREIGN KEY ("weekId") REFERENCES "public"."Week"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "public"."Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_fantasyPlayerId_fkey" FOREIGN KEY ("fantasyPlayerId") REFERENCES "public"."FantasyPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Transaction" ADD CONSTRAINT "Transaction_rosterSlotId_fkey" FOREIGN KEY ("rosterSlotId") REFERENCES "public"."RosterSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Trade" ADD CONSTRAINT "Trade_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Trade" ADD CONSTRAINT "Trade_proposerTeamId_fkey" FOREIGN KEY ("proposerTeamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Trade" ADD CONSTRAINT "Trade_recipientTeamId_fkey" FOREIGN KEY ("recipientTeamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeItem" ADD CONSTRAINT "TradeItem_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "public"."Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeItem" ADD CONSTRAINT "TradeItem_fromTeamId_fkey" FOREIGN KEY ("fromTeamId") REFERENCES "public"."Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TradeItem" ADD CONSTRAINT "TradeItem_fantasyPlayerId_fkey" FOREIGN KEY ("fantasyPlayerId") REFERENCES "public"."FantasyPlayer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ProviderStatus" ADD CONSTRAINT "ProviderStatus_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

