/** Decode `dn=` display name from a magnet URI (RFC-ish `dn` param). */
export function parseMagnetDisplayName(uri: string | null | undefined): string | null {
  if (uri == null || typeof uri !== "string") {
    return null;
  }
  const trimmed = uri.trim();
  if (!trimmed.toLowerCase().startsWith("magnet:")) {
    return null;
  }
  const m = /[?&]dn=([^&]+)/i.exec(trimmed);
  if (!m?.[1]) {
    return null;
  }
  try {
    const decoded = decodeURIComponent(m[1].replace(/\+/g, " "));
    const s = decoded.trim();
    return s.length > 0 ? s : null;
  } catch {
    return null;
  }
}

export function isMagnetLikeString(s: string | null | undefined): boolean {
  if (s == null || typeof s !== "string") {
    return false;
  }
  return s.trim().toLowerCase().startsWith("magnet:");
}
