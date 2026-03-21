export const LEAGUE_VIEW_TEAM_PARAM = "viewTeamId";

export function normalizeLeagueViewTeamId(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function appendLeagueView(path: string, viewTeamId: string | null | undefined): string {
  const normalizedViewTeamId = normalizeLeagueViewTeamId(viewTeamId);
  if (!normalizedViewTeamId) {
    return path;
  }

  const hashIndex = path.indexOf("#");
  const pathname = hashIndex >= 0 ? path.slice(0, hashIndex) : path;
  const hash = hashIndex >= 0 ? path.slice(hashIndex) : "";
  const separator = pathname.includes("?") ? "&" : "?";

  return `${pathname}${separator}${LEAGUE_VIEW_TEAM_PARAM}=${encodeURIComponent(normalizedViewTeamId)}${hash}`;
}

export function setLeagueViewTeamParam(
  searchParams: URLSearchParams,
  viewTeamId: string | null | undefined,
): URLSearchParams {
  const nextSearchParams = new URLSearchParams(searchParams);
  const normalizedViewTeamId = normalizeLeagueViewTeamId(viewTeamId);

  if (normalizedViewTeamId) {
    nextSearchParams.set(LEAGUE_VIEW_TEAM_PARAM, normalizedViewTeamId);
  } else {
    nextSearchParams.delete(LEAGUE_VIEW_TEAM_PARAM);
  }

  return nextSearchParams;
}
