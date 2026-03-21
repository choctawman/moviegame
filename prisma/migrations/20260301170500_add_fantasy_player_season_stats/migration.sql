-- CreateTable
CREATE TABLE "public"."FantasyPlayerSeasonStat" (
    "id" TEXT NOT NULL,
    "fantasyPlayerId" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "pointsTotal" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pointsBoxOffice" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "pointsRt" INTEGER NOT NULL DEFAULT 0,
    "sourceMovieCount" INTEGER NOT NULL DEFAULT 0,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FantasyPlayerSeasonStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FantasyPlayerSeasonStat_seasonYear_idx" ON "public"."FantasyPlayerSeasonStat"("seasonYear");

-- CreateIndex
CREATE UNIQUE INDEX "FantasyPlayerSeasonStat_fantasyPlayerId_seasonYear_key" ON "public"."FantasyPlayerSeasonStat"("fantasyPlayerId", "seasonYear");

-- AddForeignKey
ALTER TABLE "public"."FantasyPlayerSeasonStat" ADD CONSTRAINT "FantasyPlayerSeasonStat_fantasyPlayerId_fkey" FOREIGN KEY ("fantasyPlayerId") REFERENCES "public"."FantasyPlayer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
