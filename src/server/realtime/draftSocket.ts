import type { Server as SocketIOServer, Socket } from "socket.io";

import { draftStateService } from "@/server/services/draftStateService";

interface DraftJoinPayload {
  leagueId: string;
}

export function registerDraftSocketNamespace(io: SocketIOServer): void {
  const namespace = io.of("/draft");

  namespace.on("connection", (socket: Socket) => {
    socket.on("draft:join", async ({ leagueId }: DraftJoinPayload) => {
      if (!leagueId) {
        socket.emit("draft:error", { message: "leagueId is required" });
        return;
      }

      await socket.join(leagueId);
      const state = await draftStateService.getState(leagueId);
      socket.emit("draft:state", { fullState: state });
    });

    socket.on("draft:leave", async ({ leagueId }: DraftJoinPayload) => {
      if (leagueId) {
        await socket.leave(leagueId);
      }
    });

    socket.on("draft:pick", async ({ leagueId, fantasyPlayerId }) => {
      try {
        const pick = await draftStateService.makePick({ leagueId, fantasyPlayerId });
        namespace.to(leagueId).emit("draft:pickMade", { pick });
        namespace.to(leagueId).emit("draft:state", {
          fullState: await draftStateService.getState(leagueId),
        });
      } catch (error) {
        socket.emit("draft:error", { message: (error as Error).message });
      }
    });

    socket.on("draft:pause", async ({ leagueId }) => {
      await draftStateService.pause(leagueId);
      namespace.to(leagueId).emit("draft:paused");
    });

    socket.on("draft:resume", async ({ leagueId }) => {
      await draftStateService.resume(leagueId);
      namespace.to(leagueId).emit("draft:resumed");
    });

    socket.on("draft:forcePick", async ({ leagueId, teamId, fantasyPlayerId }) => {
      try {
        const pick = await draftStateService.forcePick({ leagueId, teamId, fantasyPlayerId });
        namespace.to(leagueId).emit("draft:pickMade", { pick });
      } catch (error) {
        socket.emit("draft:error", { message: (error as Error).message });
      }
    });

    socket.on("draft:undoPick", async ({ leagueId }) => {
      try {
        await draftStateService.undoPick(leagueId);
        namespace.to(leagueId).emit("draft:state", {
          fullState: await draftStateService.getState(leagueId),
        });
      } catch (error) {
        socket.emit("draft:error", { message: (error as Error).message });
      }
    });

    socket.on("draft:nominate", async ({ leagueId, fantasyPlayerId, teamId }) => {
      try {
        const nomination = await draftStateService.nominate({
          leagueId,
          fantasyPlayerId,
          nominatingTeamId: teamId,
        });
        namespace.to(leagueId).emit("draft:nomination", { nomination });
      } catch (error) {
        socket.emit("draft:error", { message: (error as Error).message });
      }
    });

    socket.on("draft:bid", async ({ leagueId, nominationId, amount, teamId }) => {
      try {
        const bidState = await draftStateService.bid({
          leagueId,
          nominationId,
          amount,
          bidTeamId: teamId,
        });
        namespace.to(leagueId).emit("draft:bidUpdate", bidState);
      } catch (error) {
        socket.emit("draft:error", { message: (error as Error).message });
      }
    });
  });
}
