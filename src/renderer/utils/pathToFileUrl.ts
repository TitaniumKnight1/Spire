/** Build a `file:` URL for an absolute filesystem path (renderer-safe, no Node APIs). */
export function pathToFileUrlHref(absPath: string): string {
  const posix = absPath.trim().replace(/\\/g, "/");
  const isWinDrive = /^[A-Za-z]:\//.test(posix);
  const pathPart = isWinDrive ? `/${posix}` : posix.startsWith("/") ? posix : `/${posix}`;
  const segments = pathPart.split("/");
  const encoded: string[] = [];
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i]!;
    if (seg === "" && i === 0) {
      continue;
    }
    if (/^[A-Za-z]:$/.test(seg)) {
      encoded.push(seg);
    } else {
      encoded.push(encodeURIComponent(seg));
    }
  }
  return `file://${encoded.join("/")}`;
}
