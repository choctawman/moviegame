import "dotenv/config";

import path from "node:path";
import fs from "node:fs/promises";

import { FantasyRole, PrismaClient } from "@prisma/client";
import { chromium } from "playwright";

import { hashPassword } from "@/server/auth/password";
import { addTeamToLeague, createLeague } from "@/server/services/leagueService";
import { generateLeagueWeeks } from "@/server/services/weekService";
import { isValidIanaTimezone } from "@/server/utils/time";

const prisma = new PrismaClient();

const BASE_URL = process.env.APP_URL ?? "http://localhost:3000";
const OUTPUT_DIR = path.resolve(process.cwd(), "artifacts/screenshots");

interface DemoIds {
  leagueId: string;
  weekId: string;
  teamId: string;
  fantasyPlayerId: string;
}

async function ensureDemoIds(): Promise<DemoIds> {
  const email = "commissioner@example.com";

  const user =
    (await prisma.user.findUnique({ where: { email } })) ??
    (await prisma.user.create({
      data: {
        email,
        passwordHash: await hashPassword("password123"),
        isCommissioner: true,
      },
    }));

  const commissionerLeagues = await prisma.league.findMany({
    where: { commissionerUserId: user.id },
    orderBy: { createdAt: "asc" },
  });

  const validLeague = commissionerLeagues.find((candidate) => isValidIanaTimezone(candidate.timezone));

  const league =
    validLeague ??
    (await createLeague({
      name: `${new Date().getFullYear()} Movie League`,
      seasonYear: new Date().getFullYear(),
      timezone: "America/New_York",
      commissionerUserId: user.id,
    }));

  let team = await prisma.team.findFirst({
    where: {
      leagueId: league.id,
      ownerUserId: user.id,
    },
  });

  if (!team) {
    team = await addTeamToLeague({
      leagueId: league.id,
      ownerUserId: user.id,
      name: "Commissioner Team",
    });
  }

  let week = await prisma.week.findFirst({
    where: { leagueId: league.id },
    orderBy: { index: "asc" },
  });

  if (!week) {
    await generateLeagueWeeks(league.id, league.seasonYear, league.timezone);
    week = await prisma.week.findFirst({
      where: { leagueId: league.id },
      orderBy: { index: "asc" },
    });
  }

  if (!week) {
    throw new Error("No weeks found for league after generation");
  }

  let fantasyPlayer = await prisma.fantasyPlayer.findFirst({
    orderBy: { id: "asc" },
  });

  if (!fantasyPlayer) {
    const person = await prisma.person.create({
      data: {
        name: "Demo Actor",
      },
    });

    fantasyPlayer = await prisma.fantasyPlayer.create({
      data: {
        personId: person.id,
        role: FantasyRole.LEADING_ACTOR,
      },
    });
  }

  const slot = await prisma.rosterSlot.findFirst({
    where: {
      teamId: team.id,
      role: fantasyPlayer.role,
      fantasyPlayerId: null,
    },
    orderBy: { slotIndex: "asc" },
  });

  if (slot) {
    const alreadyRostered = await prisma.rosterSlot.findFirst({
      where: {
        team: { leagueId: league.id },
        fantasyPlayerId: fantasyPlayer.id,
      },
    });

    if (!alreadyRostered) {
      await prisma.rosterSlot.update({
        where: { id: slot.id },
        data: { fantasyPlayerId: fantasyPlayer.id },
      });
    }
  }

  return {
    leagueId: league.id,
    weekId: week.id,
    teamId: team.id,
    fantasyPlayerId: fantasyPlayer.id,
  };
}

async function capture(): Promise<void> {
  const ids = await ensureDemoIds();

  await fs.mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();

  const pages: Array<{ name: string; url: string }> = [
    { name: "00-login", url: "/login" },
    { name: "01-signup", url: "/signup" },
  ];

  for (const item of pages) {
    await page.goto(`${BASE_URL}${item.url}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${item.name}.png`), fullPage: true });
  }

  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.fill('input[type="email"]', "commissioner@example.com");
  await page.fill('input[type="password"]', "password123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/");

  const authedPages: Array<{ name: string; url: string }> = [
    { name: "02-home", url: "/" },
    { name: "03-league-home", url: `/leagues/${ids.leagueId}` },
    { name: "04-league-rules", url: `/leagues/${ids.leagueId}/rules` },
    { name: "05-league-standings", url: `/leagues/${ids.leagueId}/standings` },
    { name: "06-league-schedule", url: `/leagues/${ids.leagueId}/schedule` },
    { name: "07-league-matchups-week", url: `/leagues/${ids.leagueId}/matchups/${ids.weekId}` },
    { name: "08-team-roster", url: `/teams/${ids.teamId}/roster` },
    { name: "09-player-pool", url: `/leagues/${ids.leagueId}/player-pool` },
    { name: "10-fantasy-player-detail", url: `/fantasy-players/${ids.fantasyPlayerId}` },
    { name: "11-waivers", url: `/leagues/${ids.leagueId}/waivers` },
    { name: "12-trades", url: `/leagues/${ids.leagueId}/trades` },
    { name: "13-draft", url: `/leagues/${ids.leagueId}/draft` },
  ];

  for (const item of authedPages) {
    await page.goto(`${BASE_URL}${item.url}`, { waitUntil: "networkidle" });
    await page.screenshot({ path: path.join(OUTPUT_DIR, `${item.name}.png`), fullPage: true });
  }

  await browser.close();

  console.log(`Captured ${pages.length + authedPages.length} screenshots to ${OUTPUT_DIR}`);
}

capture()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
