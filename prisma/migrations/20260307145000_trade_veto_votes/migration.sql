CREATE TABLE "TradeVetoVote" (
  "id" TEXT NOT NULL,
  "tradeId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TradeVetoVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TradeVetoVote_tradeId_teamId_key" ON "TradeVetoVote"("tradeId", "teamId");
CREATE INDEX "TradeVetoVote_tradeId_idx" ON "TradeVetoVote"("tradeId");
CREATE INDEX "TradeVetoVote_teamId_idx" ON "TradeVetoVote"("teamId");

ALTER TABLE "TradeVetoVote"
ADD CONSTRAINT "TradeVetoVote_tradeId_fkey"
FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TradeVetoVote"
ADD CONSTRAINT "TradeVetoVote_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
