"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";

import { appendLeagueView } from "@/lib/leagueView";

interface MatchupCarouselPlayer {
  slotKey: string;
  slotLabel: string;
  playerName: string | null;
  playerImageUrl: string | null;
  weekPoints: string;
  fantasyPlayerId: string | null;
}

interface MatchupCarouselItem {
  id: string;
  homeTeam: {
    id: string;
    name: string;
    record: string;
    score: string;
  };
  awayTeam: {
    id: string;
    name: string;
    record: string;
    score: string;
  };
  slotComparisons: Array<{
    slotKey: string;
    slotLabel: string;
    home: MatchupCarouselPlayer;
    away: MatchupCarouselPlayer;
  }>;
}

function teamInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function playerInitials(name: string | null): string {
  if (!name) {
    return "--";
  }
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join("");
}

function compactPlayerName(name: string | null): string {
  if (!name) {
    return "Empty";
  }

  const parts = name.trim().split(/\s+/);
  if (parts.length < 2) {
    return name;
  }

  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function PlayerCell({
  leagueId,
  player,
  align = "left",
}: {
  leagueId: string;
  player: MatchupCarouselPlayer;
  align?: "left" | "right";
}) {
  const imageClass = "h-12 w-12 rounded-lg border border-white/10 object-cover";
  const textAlignClass = align === "right" ? "text-right" : "text-left";
  const rowAlignClass = align === "right" ? "justify-end" : "justify-start";
  const playerHref = player.fantasyPlayerId ? `/fantasy-players/${player.fantasyPlayerId}?leagueId=${leagueId}` : "#";

  return (
    <div className={`min-w-0 ${textAlignClass}`}>
      <div className={`flex items-center gap-3 ${rowAlignClass}`}>
        {align === "right" ? (
          <>
            <div className="min-w-0">
              {player.fantasyPlayerId ? (
                <Link href={playerHref} className="block text-sm font-semibold leading-tight text-white sm:text-base">
                  <span className="line-clamp-2">{compactPlayerName(player.playerName)}</span>
                </Link>
              ) : (
                <p className="text-sm font-semibold text-white sm:text-base">Empty</p>
              )}
              <p className="text-sm text-slate-400">{player.weekPoints} pts</p>
            </div>
            {player.fantasyPlayerId ? (
              <Link href={playerHref} className="shrink-0">
                {player.playerImageUrl ? (
                  <Image
                    src={player.playerImageUrl}
                    alt={`${player.playerName} photo`}
                    width={48}
                    height={48}
                    className={imageClass}
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-slate-900/80 text-sm font-semibold text-slate-200">
                    {playerInitials(player.playerName)}
                  </div>
                )}
              </Link>
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-slate-900/80 text-sm font-semibold text-slate-200">
                --
              </div>
            )}
          </>
        ) : (
          <>
            {player.fantasyPlayerId ? (
              <Link href={playerHref} className="shrink-0">
                {player.playerImageUrl ? (
                  <Image
                    src={player.playerImageUrl}
                    alt={`${player.playerName} photo`}
                    width={48}
                    height={48}
                    className={imageClass}
                  />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-slate-900/80 text-sm font-semibold text-slate-200">
                    {playerInitials(player.playerName)}
                  </div>
                )}
              </Link>
            ) : (
              <div className="flex h-12 w-12 items-center justify-center rounded-lg border border-white/10 bg-slate-900/80 text-sm font-semibold text-slate-200">
                --
              </div>
            )}
            <div className="min-w-0">
              {player.fantasyPlayerId ? (
                <Link href={playerHref} className="block text-sm font-semibold leading-tight text-white sm:text-base">
                  <span className="line-clamp-2">{compactPlayerName(player.playerName)}</span>
                </Link>
              ) : (
                <p className="text-sm font-semibold text-white sm:text-base">Empty</p>
              )}
              <p className="text-sm text-slate-400">{player.weekPoints} pts</p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function MatchupCarousel({
  leagueId,
  matchups,
  viewTeamId,
}: {
  leagueId: string;
  matchups: MatchupCarouselItem[];
  viewTeamId?: string | null;
}) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const activeMatchup = matchups[activeIndex];

  function goTo(index: number) {
    if (matchups.length === 0) {
      return;
    }
    const normalizedIndex = (index + matchups.length) % matchups.length;
    setActiveIndex(normalizedIndex);
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

    goTo(delta < 0 ? activeIndex + 1 : activeIndex - 1);
  }

  return (
    <section
      className="space-y-4"
      onTouchStart={(event) => handleTouchStart(event.changedTouches[0]?.clientX ?? 0)}
      onTouchEnd={(event) => handleTouchEnd(event.changedTouches[0]?.clientX ?? 0)}
    >
      <article className="rounded-xl border border-white/10 bg-slate-950/70 p-4 sm:p-5">
        <div className="grid grid-cols-[minmax(0,1fr)_3rem_minmax(0,1fr)] items-center gap-3 rounded-lg border border-white/10 bg-slate-900/80 p-4">
          <div className="min-w-0">
            <Link href={appendLeagueView(`/teams/${activeMatchup.homeTeam.id}/roster`, viewTeamId)} className="flex items-center gap-2">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-white/10 bg-slate-950/70 text-base font-semibold text-white">
                {teamInitials(activeMatchup.homeTeam.name)}
              </div>
              <div className="min-w-0">
                <p className="line-clamp-3 text-base font-semibold leading-tight text-white sm:line-clamp-2 sm:text-lg">{activeMatchup.homeTeam.name}</p>
                <p className="text-sm text-slate-400">{activeMatchup.homeTeam.record}</p>
              </div>
            </Link>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-white sm:mt-4 sm:text-5xl">{activeMatchup.homeTeam.score}</p>
          </div>

          <div className="flex h-12 w-12 items-center justify-center rounded-md border border-white/10 bg-slate-950/70 text-xs font-medium text-slate-300 sm:h-[3.4rem] sm:w-[3.4rem] sm:text-sm">
            VS
          </div>

          <div className="min-w-0 text-right">
            <Link href={appendLeagueView(`/teams/${activeMatchup.awayTeam.id}/roster`, viewTeamId)} className="flex items-center justify-end gap-2">
              <div className="min-w-0">
                <p className="line-clamp-3 text-base font-semibold leading-tight text-white sm:line-clamp-2 sm:text-lg">{activeMatchup.awayTeam.name}</p>
                <p className="text-sm text-slate-400">{activeMatchup.awayTeam.record}</p>
              </div>
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-md border border-white/10 bg-slate-950/70 text-base font-semibold text-white">
                {teamInitials(activeMatchup.awayTeam.name)}
              </div>
            </Link>
            <p className="mt-3 text-3xl font-semibold tracking-tight text-white sm:mt-4 sm:text-5xl">{activeMatchup.awayTeam.score}</p>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-center gap-2">
          {matchups.map((matchup, index) => (
            <button
              key={matchup.id}
              type="button"
              onClick={() => goTo(index)}
              aria-label={`Go to matchup ${index + 1}`}
              className={`h-2 w-2 rounded-full ${
                index === activeIndex ? "bg-white" : "bg-white/25"
              }`}
            />
          ))}
        </div>
      </article>

      <div className="space-y-3">
        {activeMatchup.slotComparisons.map((comparison) => (
          <article
            key={comparison.slotKey}
            className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 rounded-lg border border-white/10 bg-slate-950/70 p-3"
          >
            <PlayerCell leagueId={leagueId} player={comparison.home} />

            <div className="rounded-md border border-white/10 bg-slate-900/80 px-3 py-2 text-center">
              <p className="text-xs font-medium text-slate-300">{comparison.slotLabel}</p>
            </div>

            <PlayerCell leagueId={leagueId} player={comparison.away} align="right" />
          </article>
        ))}
      </div>
    </section>
  );
}
