ALTER TABLE "TradeItem"
ALTER COLUMN "fantasyPlayerId" DROP NOT NULL,
ALTER COLUMN "rosterSlotRole" DROP NOT NULL,
ALTER COLUMN "rosterSlotIndex" DROP NOT NULL;

ALTER TABLE "TradeItem"
ADD COLUMN "faabAmount" INTEGER;

ALTER TABLE "TradeItem"
ADD CONSTRAINT "TradeItem_asset_check"
CHECK (
  (
    "faabAmount" IS NULL
    AND "fantasyPlayerId" IS NOT NULL
    AND "rosterSlotRole" IS NOT NULL
    AND "rosterSlotIndex" IS NOT NULL
  )
  OR (
    "faabAmount" IS NOT NULL
    AND "faabAmount" > 0
    AND "fantasyPlayerId" IS NULL
    AND "rosterSlotRole" IS NULL
    AND "rosterSlotIndex" IS NULL
  )
);
