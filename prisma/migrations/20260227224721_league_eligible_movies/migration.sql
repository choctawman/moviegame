-- CreateTable
CREATE TABLE "public"."LeagueEligibleMovie" (
    "id" TEXT NOT NULL,
    "leagueId" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeagueEligibleMovie_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeagueEligibleMovie_movieId_idx" ON "public"."LeagueEligibleMovie"("movieId");

-- CreateIndex
CREATE UNIQUE INDEX "LeagueEligibleMovie_leagueId_movieId_key" ON "public"."LeagueEligibleMovie"("leagueId", "movieId");

-- AddForeignKey
ALTER TABLE "public"."LeagueEligibleMovie" ADD CONSTRAINT "LeagueEligibleMovie_leagueId_fkey" FOREIGN KEY ("leagueId") REFERENCES "public"."League"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."LeagueEligibleMovie" ADD CONSTRAINT "LeagueEligibleMovie_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "public"."Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;
