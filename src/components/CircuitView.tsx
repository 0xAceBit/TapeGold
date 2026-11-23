import { evalSignals, signalName, validateDesign, type Design, type Gate } from '@/mock/netlist';

interface Props {
  nIn: number;
  nOut: number;
  gates: Gate[];
  /** Which switches are on, as a bit mask: switch i is bit i. */
  vector: number;
  onVector: (v: number) => void;
  /** The answer the puzzle wants for this vector, if known. */
  want?: number;
  /** Gates to ring in amber (the hint). */
  highlight?: number[];
}

interface Node {
  sig: number;
  x: number;
  y: number;
}

const COL = 128;
const ROW = 66;
const PAD_X = 52;
const PAD_Y = 36;
const GATE_W = 78;
const GATE_H = 42;

const ON = 'var(--success)';
const OFF = 'var(--subtle)';

/** A drawing of the circuit. Flip the switches and the wires and bricks light up with the real answer. */
export function CircuitView({ nIn, nOut, gates, vector, onVector, want, highlight = [] }: Props) {
  const design: Design = { nIn, nOut, gates };
  const problem = validateDesign(design);
  if (problem) {
    return (
      <p className="inset p-4 text-sm" style={{ color: 'var(--muted)' }}>
        {gates.length === 0 ? 'Add a gate and the picture of your circuit appears here.' : `The picture appears once the wiring is valid. ${problem}`}
      </p>
    );
  }

  const sig = evalSignals(design, vector);
  const total = sig.length;
  const first = total - nOut;

  // Column = how many bricks the signal passed through. Constants only appear if something reads them.
  const depth = new Array<number>(total).fill(0);
  gates.forEach((gt, k) => {
    depth[2 + nIn + k] = 1 + Math.max(depth[gt.a], depth[gt.b]);
  });
  const usesConst = (c: number) => gates.some((gt) => gt.a === c || gt.b === c);
  const sources = [...(usesConst(0) ? [0] : []), ...(usesConst(1) ? [1] : []), ...Array.from({ length: nIn }, (_, i) => 2 + i)];
  const maxDepth = Math.max(0, ...gates.map((_, k) => depth[2 + nIn + k]));
  const columns: number[][] = Array.from({ length: maxDepth + 2 }, () => []);
  columns[0] = sources;
  gates.forEach((_, k) => columns[depth[2 + nIn + k]].push(2 + nIn + k));
  const lampCol = maxDepth + 1;
  columns[lampCol] = Array.from({ length: nOut }, (_, j) => -1 - j);

  const rows = Math.max(...columns.map((c) => c.length));
  const H = PAD_Y * 2 + (rows - 1) * ROW + GATE_H;
  const W = PAD_X * 2 + (columns.length - 1) * COL;
  const pos = new Map<number, Node>();
  columns.forEach((col, c) => {
    const top = (H - (col.length - 1) * ROW) / 2;
    col.forEach((s, r) => pos.set(s, { sig: s, x: PAD_X + c * COL, y: top + r * ROW }));
  });

  const wire = (from: number, to: { x: number; y: number }) => {
    const s = pos.get(from)!;
    const x1 = s.x + (from >= 2 + nIn ? GATE_W / 2 : from < 2 ? 14 : 15);
    const mid = (x1 + to.x) / 2;
    const lit = sig[from] === 1;
    return (
      <path
        key={`${from}-${to.x}-${to.y}`}
        d={`M ${x1} ${s.y} C ${mid} ${s.y}, ${mid} ${to.y}, ${to.x} ${to.y}`}
        fill="none"
        stroke={lit ? ON : OFF}
        strokeOpacity={lit ? 1 : 0.4}
        strokeWidth={lit ? 3 : 2}
        strokeLinecap="round"
      />
    );
  };

  const outBits = Array.from({ length: nOut }, (_, j) => sig[first + j]);
  const outValue = outBits.reduce((acc, b, j) => acc | (b << j), 0);
  const ok = want === undefined ? null : outValue === want;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Switches">
        <span className="eyebrow mr-1">Flip the switches</span>
        {Array.from({ length: nIn }, (_, i) => {
          const on = ((vector >> i) & 1) === 1;
          return (
            <button
              key={i}
              type="button"
              className="btn btn-sm num"
              aria-pressed={on}
              onClick={() => onVector(vector ^ (1 << i))}
              style={on ? { background: 'var(--success)', color: '#fff', borderColor: 'var(--success)' } : undefined}
            >
              in{i} {on ? 'ON' : 'OFF'}
            </button>
          );
        })}
      </div>

      <div className="inset overflow-x-auto p-2">
        <svg role="img" aria-label="Diagram of your circuit with live wire values" width={W} height={H} viewBox={`0 0 ${W} ${H}`} style={{ maxWidth: 'none', display: 'block', margin: '0 auto' }}>
          {gates.flatMap((gt, k) => {
            const me = pos.get(2 + nIn + k)!;
            const port = (dy: number) => ({ x: me.x - GATE_W / 2, y: me.y + dy });
            return [wire(gt.a, port(-9)), wire(gt.b, port(9))];
          })}
          {Array.from({ length: nOut }, (_, j) => wire(first + j, { x: pos.get(-1 - j)!.x - 18, y: pos.get(-1 - j)!.y }))}

          {sources.map((s) => {
            const n = pos.get(s)!;
            const on = sig[s] === 1;
            const isSwitch = s >= 2;
            const i = s - 2;
            const flip = () => onVector(vector ^ (1 << i));
            return (
              <g
                key={s}
                role={isSwitch ? 'button' : undefined}
                tabIndex={isSwitch ? 0 : undefined}
                aria-pressed={isSwitch ? on : undefined}
                aria-label={isSwitch ? `in${i} is ${on ? 'on' : 'off'}. Press to flip it.` : undefined}
                style={{ cursor: isSwitch ? 'pointer' : 'default', outline: 'none' }}
                onClick={isSwitch ? flip : undefined}
                onKeyDown={isSwitch ? (e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), flip()) : undefined}
              >
                <circle cx={n.x} cy={n.y} r={24} fill="transparent" />
                <circle cx={n.x} cy={n.y} r={15} fill={on ? ON : 'var(--surface-muted)'} stroke={on ? ON : OFF} strokeWidth={2} />
                <text x={n.x} y={n.y + 4.5} textAnchor="middle" fontSize={13} fontWeight={700} fill={on ? '#fff' : 'var(--ink-2)'} className="num">
                  {sig[s]}
                </text>
                <text x={n.x} y={n.y + 31} textAnchor="middle" fontSize={11} fill="var(--muted)" className="mono">
                  {signalName(s, nIn)}
                </text>
              </g>
            );
          })}

          {gates.map((gt, k) => {
            const s = 2 + nIn + k;
            const n = pos.get(s)!;
            const on = sig[s] === 1;
            const flagged = highlight.includes(k);
            return (
              <g key={k}>
                {flagged && (
                  <rect x={n.x - GATE_W / 2 - 5} y={n.y - GATE_H / 2 - 5} width={GATE_W + 10} height={GATE_H + 10} rx={14} fill="none" stroke="var(--warn)" strokeWidth={2.5} strokeDasharray="5 4" />
                )}
                <rect
                  x={n.x - GATE_W / 2}
                  y={n.y - GATE_H / 2}
                  width={GATE_W}
                  height={GATE_H}
                  rx={10}
                  fill={on ? 'rgba(26,128,71,0.12)' : 'var(--surface-muted)'}
                  stroke={on ? ON : OFF}
                  strokeWidth={2}
                />
                <text x={n.x - GATE_W / 2 + 10} y={n.y - 2} fontSize={13} fontWeight={700} fill="var(--ink)" className="mono">
                  g{k}
                </text>
                <text x={n.x - GATE_W / 2 + 10} y={n.y + 12} fontSize={10} fill="var(--muted)">
                  {gt.a === gt.b ? 'flip' : 'NAND'}
                </text>
                <circle cx={n.x + GATE_W / 2 - 16} cy={n.y} r={11} fill={on ? ON : 'var(--surface)'} stroke={on ? ON : OFF} strokeWidth={1.5} />
                <text x={n.x + GATE_W / 2 - 16} y={n.y + 4.5} textAnchor="middle" fontSize={12} fontWeight={700} fill={on ? '#fff' : 'var(--ink-2)'} className="num">
                  {sig[s]}
                </text>
              </g>
            );
          })}

          {outBits.map((b, j) => {
            const n = pos.get(-1 - j)!;
            const wantBit = want === undefined ? null : (want >> j) & 1;
            const wrong = wantBit !== null && wantBit !== b;
            return (
              <g key={j}>
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={17}
                  fill={b ? ON : 'var(--surface-muted)'}
                  stroke={wrong ? 'var(--danger)' : b ? ON : OFF}
                  strokeWidth={wrong ? 3 : 2}
                  strokeDasharray={wrong ? '4 3' : undefined}
                  style={b ? { filter: 'drop-shadow(0 0 7px rgba(26,128,71,0.55))' } : undefined}
                />
                <text x={n.x} y={n.y + 5} textAnchor="middle" fontSize={14} fontWeight={700} fill={b ? '#fff' : 'var(--ink-2)'} className="num">
                  {b}
                </text>
                <text x={n.x} y={n.y + 34} textAnchor="middle" fontSize={11} fill="var(--muted)" className="mono">
                  out{j} lamp
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="text-sm" aria-live="polite" style={{ color: ok === false ? 'var(--danger)' : 'var(--ink-2)' }}>
        Switches {Array.from({ length: nIn }, (_, i) => `in${i}=${(vector >> i) & 1}`).join(' ')}: your lamp shows{' '}
        <span className="num font-semibold">{outBits.join(' ')}</span>
        {want !== undefined && (
          <>
            . The answer sheet wants <span className="num font-semibold">{Array.from({ length: nOut }, (_, j) => (want >> j) & 1).join(' ')}</span>
            {ok ? '. Correct for this row.' : '. Not a match for this row.'}
          </>
        )}
      </p>
    </div>
  );
}
