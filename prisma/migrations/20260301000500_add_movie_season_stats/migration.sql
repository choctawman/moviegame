-- CreateTable
CREATE TABLE "public"."MovieSeasonStat" (
    "id" TEXT NOT NULL,
    "movieId" TEXT NOT NULL,
    "seasonYear" INTEGER NOT NULL,
    "worldwideGrossUsd" BIGINT NOT NULL DEFAULT 0,
    "rtCriticsScore" INTEGER,
    "rtAudienceScore" INTEGER,
    "snapshotAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MovieSeasonStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MovieSeasonStat_seasonYear_idx" ON "public"."MovieSeasonStat"("seasonYear");

-- CreateIndex
CREATE UNIQUE INDEX "MovieSeasonStat_movieId_seasonYear_key" ON "public"."MovieSeasonStat"("movieId", "seasonYear");

-- AddForeignKey
ALTER TABLE "public"."MovieSeasonStat" ADD CONSTRAINT "MovieSeasonStat_movieId_fkey" FOREIGN KEY ("movieId") REFERENCES "public"."Movie"("id") ON DELETE CASCADE ON UPDATE CASCADE;
