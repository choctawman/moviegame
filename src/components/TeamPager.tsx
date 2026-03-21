"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { appendLeagueView } from "@/lib/leagueView";

export function TeamPager({
  teams,
  currentTeamId,
  anchorTeamId,
  viewTeamId,
}: {
  teams: Array<{ id: string; name: string }>;
  currentTeamId: string;
  anchorTeamId?: string | null;
  viewTeamId?: string | null;
}) {
  const router = useRouter();
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const orderedTeams =
    anchorTeamId && teams.some((team) => team.id === anchorTeamId)
      ? [...teams.filter((team) => team.id === anchorTeamId), ...teams.filter((team) => team.id !== anchorTeamId)]
      : teams;
  const currentIndex = Math.max(
    0,
    orderedTeams.findIndex((team) => team.id === currentTeamId),
  );

  function goTo(index: number) {
    const target = orderedTeams[index];
    if (!target || target.id === currentTeamId) {
      return;
    }
    router.push(appendLeagueView(`/teams/${target.id}/roster`, viewTeamId));
  }

  function handleTouchStart(clientX: number) {
    setTouchStartX(clientX);
  }

  function handleTouchEnd(clientX: number) {
    if (touchStartX == null) {
      return;
    }
    const delta = clientX - touchStartX;
    setTouchStartX(null);
    if (Math.abs(delta) < 40) {
      return;
    }
    if (delta < 0 && currentIndex < teams.length - 1) {
      goTo(currentIndex + 1);
    }
    if (delta > 0 && currentIndex > 0) {
      goTo(currentIndex - 1);
    }
  }

  return (
    <section
      className="space-y-3"
      onTouchStart={(event) => handleTouchStart(event.changedTouches[0]?.clientX ?? 0)}
      onTouchEnd={(event) => handleTouchEnd(event.changedTouches[0]?.clientX ?? 0)}
    >
      <div className="flex items-center justify-center gap-2">
        {orderedTeams.map((team, index) => (
          <Link
            key={team.id}
            href={appendLeagueView(`/teams/${team.id}/roster`, viewTeamId)}
            aria-label={team.name}
            className={`h-2 w-2 rounded-full ${
              index === currentIndex ? "bg-white" : "bg-white/25"
            }`}
          />
        ))}
      </div>
    </section>
  );
}
