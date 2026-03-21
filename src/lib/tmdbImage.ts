const TMDB_IMAGE_BASE_URL = "https://image.tmdb.org/t/p";

export function tmdbImageUrl(path: string | null | undefined, size: string): string | null {
  if (!path) {
    return null;
  }

  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${TMDB_IMAGE_BASE_URL}/${size}${normalizedPath}`;
}
