export interface CardInput {
  /** "Full adder", "Daily puzzle 12". */
  title: string;
  gates: number;
  par: number;
  stars: 1 | 2 | 3;
  name?: string;
  streak?: number;
}

const INK = '#1e1e1f';
const MUTED = '#6b6b6e';
const GOLD = '#d9b46a';

function star(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, filled: boolean): void {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42;
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  if (filled) {
    ctx.fillStyle = GOLD;
    ctx.fill();
  }
  ctx.lineWidth = 3;
  ctx.strokeStyle = filled ? GOLD : '#bfbfbf';
  ctx.stroke();
}

function loadImage(src: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

/** Draws a 1200 x 630 picture of a result, to post or save. Runs in the browser; nothing is uploaded. */
export async function renderShareCard(input: CardInput): Promise<Blob> {
  await Promise.all([
    document.fonts.load('500 80px "Geist Variable"'),
    document.fonts.load('italic 80px "Instrument Serif"'),
    document.fonts.load('20px "PT Mono"'),
  ]).catch(() => undefined);
  const canvas = document.createElement('canvas');
  canvas.width = 1200;
  canvas.height = 630;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Drawing is not available in this browser.');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 1200, 630);
  ctx.fillStyle = INK;
  ctx.fillRect(0, 618, 1200, 12);

  const [face, portrait] = await Promise.all([loadImage('./favicon.svg'), loadImage('./icon-512.png')]);
  if (face) ctx.drawImage(face, 72, 56, 52, 52);
  if (portrait) {
    ctx.fillStyle = '#f3f3f2';
    ctx.beginPath();
    ctx.arc(960, 300, 190, 0, Math.PI * 2);
    ctx.fill();
    ctx.drawImage(portrait, 790, 130, 340, 340);
  }
  ctx.fillStyle = INK;
  ctx.fillStyle = INK;
  ctx.font = '500 36px "Geist Variable", sans-serif';
  ctx.fillText('TapeGold', 138, 94);
  const w = ctx.measureText('TapeGold').width;
  ctx.fillStyle = '#999999';
  ctx.font = 'italic 34px "Instrument Serif", serif';
  ctx.fillText('golf', 138 + w + 6, 94);

  ctx.fillStyle = MUTED;
  ctx.font = '22px "PT Mono", monospace';
  ctx.fillText(input.name ? `${input.name.toUpperCase()} SOLVED` : 'SOLVED', 72, 220);

  ctx.fillStyle = INK;
  ctx.font = '500 92px "Geist Variable", sans-serif';
  ctx.fillText(input.title, 72, 316, 700);

  ctx.font = '500 92px "Geist Variable", sans-serif';
  const lead = 'in ';
  ctx.fillText(lead, 72, 416);
  const x1 = 72 + ctx.measureText(lead).width;
  ctx.font = 'italic 110px "Instrument Serif", serif';
  const n = String(input.gates);
  ctx.fillText(n, x1, 416);
  const x2 = x1 + ctx.measureText(n).width + 20;
  ctx.font = '500 92px "Geist Variable", sans-serif';
  ctx.fillText(input.gates === 1 ? 'brick' : 'bricks', x2, 416);

  for (let i = 0; i < 3; i++) star(ctx, 100 + i * 70, 500, 28, i < input.stars);

  ctx.fillStyle = MUTED;
  ctx.font = '400 28px "Geist Variable", sans-serif';
  const line = `Best known: ${input.par}.${input.streak && input.streak > 1 ? `  ${input.streak}-day streak.` : ''}  Can you beat it?`;
  ctx.fillText(line, 72, 568);

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the picture.'))), 'image/png'));
}
