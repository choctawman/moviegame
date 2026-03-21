-- AlterTable
ALTER TABLE "public"."Team" ADD COLUMN     "waiverBudget" INTEGER NOT NULL DEFAULT 100;

-- AlterTable
ALTER TABLE "public"."WaiverClaim" ADD COLUMN     "bidAmount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "targetRosterSlotId" TEXT;

-- AddForeignKey
ALTER TABLE "public"."WaiverClaim" ADD CONSTRAINT "WaiverClaim_targetRosterSlotId_fkey" FOREIGN KEY ("targetRosterSlotId") REFERENCES "public"."RosterSlot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
