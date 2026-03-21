CREATE TABLE "TradeApproveVote" (
  "id" TEXT NOT NULL,
  "tradeId" TEXT NOT NULL,
  "teamId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "TradeApproveVote_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TradeApproveVote_tradeId_teamId_key" ON "TradeApproveVote"("tradeId", "teamId");
CREATE INDEX "TradeApproveVote_tradeId_idx" ON "TradeApproveVote"("tradeId");
CREATE INDEX "TradeApproveVote_teamId_idx" ON "TradeApproveVote"("teamId");

ALTER TABLE "TradeApproveVote"
ADD CONSTRAINT "TradeApproveVote_tradeId_fkey"
FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "TradeApproveVote"
ADD CONSTRAINT "TradeApproveVote_teamId_fkey"
FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
