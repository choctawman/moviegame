-- Backfill bench slots for existing teams (5 slots each)
INSERT INTO "public"."RosterSlot" ("id", "teamId", "role", "slotIndex", "fantasyPlayerId")
SELECT
  md5(random()::text || clock_timestamp()::text || t."id" || gs."idx"::text),
  t."id",
  'BENCH'::"public"."FantasyRole",
  gs."idx",
  NULL
FROM "public"."Team" t
CROSS JOIN generate_series(1, 5) AS gs("idx")
LEFT JOIN "public"."RosterSlot" rs
  ON rs."teamId" = t."id"
  AND rs."role" = 'BENCH'::"public"."FantasyRole"
  AND rs."slotIndex" = gs."idx"
WHERE rs."id" IS NULL;
