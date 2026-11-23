import { useState } from 'react';
import { ChevronRight, Trophy } from 'lucide-react';
import { CircuitView } from '../../components/CircuitView';
import type { Challenge } from '../arena';
import { fmtToken, shortAddr } from '../format';
import { usePoll } from '../hooks';
import { readWinningCircuit } from '../netlist';
import { describeSpec } from '../specs';
import { featured, hallOfFame } from '../stats';
import { AddrLink, Spinner } from './ui';

/** The biggest open challenge, shown first. Chosen from the contract's own data; nobody can pin one. */
export function FeaturedChallenge({ list, now }: { list: Challenge[]; now: number }) {
  const ch = featured(list);
  if (!ch) return null;
  const info = describeSpec(ch.nIn, ch.nOut, ch.table);
  const left = (ch.phase === 0 ? ch.commitEnd : ch.revealEnd) - now;
  const hours = Math.max(0, Math.floor(left / 3600));
  return (
    <a href={`#/c/${ch.id}`} className="sheet sheet-pad block text-inherit no-underline transition-transform duration-200 hover:-translate-y-0.5" aria-label={`Featured: ${info.name}`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="label">Featured · biggest open prize</span>
        <span className="chip">{ch.phase === 0 ? 'Entries open' : 'Reveals open'} · {hours >= 48 ? `${Math.floor(hours / 24)} days` : `${hours} h`} left</span>
      </div>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="display text-2xl">{info.name}</h2>
          <p className="text-[13px] text-[var(--muted)]">{ch.nIn} switches, {ch.nOut} {ch.nOut === 1 ? 'lamp' : 'lamps'} · {ch.commitCount} {ch.commitCount === 1 ? 'entry' : 'entries'}{ch.best ? ` · best so far ${ch.best.score} bricks` : ''}</p>
        </div>
        <div className="text-right">
          <div className="display num text-3xl">{fmtToken(ch.pot, ch.tokenDecimals, ch.tokenSymbol)}</div>
          <span className="inline-flex items-center gap-1 text-[13px]">Open it <ChevronRight size={14} /></span>
        </div>
      </div>
    </a>
  );
}

/** Who has won, from `bestOf` once each reveal window is over. Wallet addresses only: the chain knows no nicknames. */
export function HallOfFame({ list }: { list: Challenge[] }) {
  const rows = hallOfFame(list).filter((r) => r.wins > 0).slice(0, 5);
  if (rows.length === 0) return null;
  return (
    <section className="sheet sheet-pad space-y-3" aria-label="Hall of fame">
      <div className="flex items-center gap-2">
        <Trophy size={16} aria-hidden />
        <h2 className="text-base font-bold tracking-wide">HALL OF FAME</h2>
      </div>
      <ol className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={r.player} className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
            <span className="num w-5 font-bold">{i + 1}</span>
            <AddrLink address={r.player} />
            <span className="num">{r.wins} {r.wins === 1 ? 'win' : 'wins'}</span>
            {r.bestScore !== null && <span className="num text-[var(--muted)]">best {r.bestScore} bricks</span>}
            {r.usdcWon > 0n && <span className="num text-[var(--muted)]">{fmtToken(r.usdcWon, 6, 'USDC')} in pots</span>}
          </li>
        ))}
      </ol>
      <p className="text-[12px] text-[var(--dim)]">Pots are shown before the fee. Standard USDC only.</p>
    </section>
  );
}

/** The winning circuit drawn as a picture, once a challenge is over. */
export function WinningCircuit({ ch }: { ch: Challenge }) {
  const [vector, setVector] = useState(0);
  const best = ch.best;
  const poll = usePoll(
    () => readWinningCircuit(ch.processor, (best as NonNullable<typeof best>).circuitId, ch.nIn, ch.nOut, ch.table),
    `win:${ch.id}:${best?.circuitId}`,
    60_000,
    !!best && ch.phase >= 2,
  );
  if (!best || ch.phase < 2) return null;
  const w = poll.data;
  return (
    <section className="sheet sheet-pad space-y-3" aria-label="Winning circuit">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-bold tracking-wide">WINNING CIRCUIT</h2>
        <span className="label">{best.score} bricks · {shortAddr(best.winner)}</span>
      </div>
      {poll.loading && <Spinner label="Reading the circuit from the chain…" />}
      {poll.error && !w && <p className="bad text-[13px]" role="alert">{poll.error}</p>}
      {w && w.gates && w.matches && (
        <>
          <CircuitView nIn={ch.nIn} nOut={ch.nOut} gates={w.gates} vector={vector} onVector={setVector} />
          <p className="text-[12px] text-[var(--muted)]">Flip the switches to see how it works. This is the real circuit that won, read from the chain.</p>
        </>
      )}
      {w && (!w.gates || !w.matches) && (
        <p className="text-[13px] text-[var(--muted)]">
          This circuit uses parts the picture cannot show, so it is not drawn. Circuit #{best.circuitId.toString()} on <AddrLink address={ch.processor} />.
        </p>
      )}
    </section>
  );
}
