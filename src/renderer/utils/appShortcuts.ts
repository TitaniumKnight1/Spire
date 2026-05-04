/** Match Electron-style accelerator strings against a DOM keydown event (renderer-only). */
export function acceleratorMatchesKeyboard(accelerator: string, e: KeyboardEvent): boolean {
  const raw = accelerator.trim();
  if (!raw) {
    return false;
  }
  const parts = raw.split("+").map((s) => s.trim()).filter(Boolean);
  if (parts.some((p) => p.toLowerCase() === "commandorcontrol")) {
    return false;
  }

  let wantShift = false;
  let wantAlt = false;
  let wantCtrl = false;
  let wantMeta = false;
  let keyToken = "";

  for (const p of parts) {
    const u = p.toLowerCase();
    if (u === "shift") wantShift = true;
    else if (u === "alt") wantAlt = true;
    else if (u === "ctrl" || u === "control") wantCtrl = true;
    else if (u === "meta" || u === "command") wantMeta = true;
    else keyToken = p;
  }

  if (e.shiftKey !== wantShift || e.altKey !== wantAlt || e.ctrlKey !== wantCtrl || e.metaKey !== wantMeta) {
    return false;
  }

  return keyTokenMatches(keyToken, e);
}

function keyTokenMatches(token: string, e: KeyboardEvent): boolean {
  const t = token.trim();
  if (!t) {
    return false;
  }
  const tl = t.toLowerCase();
  if (tl === "space") return e.code === "Space";
  if (tl === "right") return e.code === "ArrowRight";
  if (tl === "left") return e.code === "ArrowLeft";
  if (tl === "f") return e.code === "KeyF";
  if (tl === "b") return e.code === "KeyB";
  if (t === "." || tl === "period") return e.code === "Period";
  if (t === "," || tl === "comma") return e.code === "Comma";
  return false;
}
