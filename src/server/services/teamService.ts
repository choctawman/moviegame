import { prisma } from "@/lib/prisma";
import { ApiError } from "@/server/api/http";

export async function getTeamRoster(teamId: string) {
  const team = await prisma.team.findUnique({
    where: { id: teamId },
    include: {
      rosterSlots: {
        orderBy: [{ role: "asc" }, { slotIndex: "asc" }],
        include: {
          fantasyPlayer: {
            include: {
              person: true,
            },
          },
        },
      },
      league: true,
    },
  });

  if (!team) {
    throw new ApiError(404, "Team not found");
  }

  return team;
}

export async function addFreeAgent(
  leagueId: string,
  teamId: string,
  fantasyPlayerId: string,
  dropRosterSlotId?: string | null,
) {
  void leagueId;
  void teamId;
  void fantasyPlayerId;
  void dropRosterSlotId;
  throw new ApiError(400, "Direct add is disabled. Use waiver nominations and waiver claims.");
}

export async function dropFromTeam(leagueId: string, teamId: string, rosterSlotId: string) {
  void leagueId;
  void teamId;
  void rosterSlotId;
  throw new ApiError(400, "Direct drop is disabled. Drop players only as part of a waiver claim.");
}
