/** S3-F #85 — QR drawn client-side with the bundled qrcode-generator (no CDN, no request). */
import qrcode from "qrcode-generator";

/** QR module matrix (true = dark), error-correction M, auto version. */
export function qrMatrix(text: string): boolean[][] {
  const q = qrcode(0, "M");
  q.addData(text, "Byte");
  q.make();
  const n = q.getModuleCount();
  return Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => q.isDark(r, c)));
}

/** Draw to a canvas: ≥ minPx, 4-module quiet zone kept, integer cells (crisp). */
export function drawQr(canvas: HTMLCanvasElement, text: string, minPx = 160): void {
  const m = qrMatrix(text);
  const quiet = 4;
  const cells = m.length + quiet * 2;
  const cell = Math.max(1, Math.ceil(minPx / cells));
  canvas.width = canvas.height = cells * cell;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";
  m.forEach((row, r) => row.forEach((dark, c) => dark && ctx.fillRect((c + quiet) * cell, (r + quiet) * cell, cell, cell)));
}

