import { ArrowLeft } from 'lucide-react';
import type { Address } from 'viem';
import { type Challenge } from '../arena';
import { countdown, fmtToken, PHASES, utc } from '../format';
import { useChallenge, useMine, useNow } from '../hooks';
import { useReveals } from '../reveals';
import { describeSpec } from '../specs';
import { useArenaTx } from '../tx';
import { useWallet } from '../wallet';
import { Leaderboard } from './Leaderboard';
import { PhaseTag } from './ChallengeList';
import { TruthTable } from './TruthTable';
import { AddrLink, KV, Note, Spinner, TxStatus } from './ui';


function Deadlines({ ch, now }: { ch: Challenge; now: number }) {
  const rows: [string, number, boolean][] = [
    ['Commit closes', ch.commitEnd, now >= ch.commitEnd],
    ['Reveal closes', ch.revealEnd, now >= ch.revealEnd],
  ];
  return (
    <div className="sheet sheet-pad grid grid-cols-1 gap-3 sm:grid-cols-2">
      {rows.map(([label, ts, passed]) => (
        <KV key={label} k={label}>
          {utc(ts)} <span className="text-[var(--dim)]">{passed ? '(passed)' : `in ${countdown(ts - now)}`}</span>
        </KV>
      ))}
    </div>
  );
}

function Actions({ arena, ch }: { arena: Address; ch: Challenge }) {
  const w = useWallet();
  const mine = useMine(arena, ch, w.account);
  const tx = useArenaTx();
  const busy = ['switching', 'simulating', 'signing', 'confirming'].includes(tx.state.step);
  const me = mine.data;
  const done = () => {
    mine.reload();
  };
  return (
    <div className="sheet sheet-pad space-y-3">
      <h2 className="text-base font-bold tracking-wide">YOUR CARD</h2>
      {!w.account && <p className="text-[var(--muted)]">Connect a wallet to enter, reveal or collect.</p>}
      {w.account && mine.loading && <Spinner label="Reading your entry…" />}
      {w.account && me && (
        <div className="space-y-3">
          <p className="text-[13px]">
            {me.commit
              ? me.commit.revealed
                ? `You revealed (commit #${me.commit.index}).`
                : `You committed (commit #${me.commit.index}). ${ch.phase === 1 ? 'Reveal it now.' : ch.phase === 0 ? 'Come back after the commit deadline to reveal.' : 'The reveal window has passed.'}`
              : ch.phase === 0
                ? 'You have not entered this challenge.'
                : 'You did not commit to this challenge.'}
          </p>
          <div className="flex flex-wrap gap-2">
            {ch.phase === 0 && !me.commit && <a className="btn btn-primary" href={`#/c/${ch.id}/commit`}>Enter: commit a circuit</a>}
            {ch.phase === 1 && me.commit && !me.commit.revealed && <a className="btn btn-primary" href={`#/c/${ch.id}/reveal`}>Reveal your circuit</a>}
            {ch.phase === 2 && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void tx.send(arena, w.account as Address, 'finalize', [BigInt(ch.id)]).then(() => { done(); })}>
                Finalize and settle
              </button>
            )}
            {ch.phase === 3 && ch.refundable && me.contribution > 0n && (
              <button type="button" className="btn" disabled={busy} onClick={() => void tx.send(arena, w.account as Address, 'claimRefund', [BigInt(ch.id)]).then(() => { done(); })}>
                Claim refund ({fmtToken(me.contribution, ch.tokenDecimals, ch.tokenSymbol)})
              </button>
            )}
            {me.pending > 0n && (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void tx.send(arena, w.account as Address, 'withdraw', [ch.token]).then(() => { done(); })}>
                Withdraw {fmtToken(me.pending, ch.tokenDecimals, ch.tokenSymbol)}
              </button>
            )}
          </div>
          <TxStatus state={tx.state} />
        </div>
      )}
      <Note tone="warn">
        The commit hash covers only the circuit id, your salt and your address, not the circuit's contents. Someone who copies a public
        circuit can tie your gate count and win on commit order. Commit before you tape out, and treat any pot as at risk.
      </Note>
    </div>
  );
}

export function ChallengeDetail({ arena, id }: { arena: Address; id: number }) {
  const { data: ch, error, loading, reload } = useChallenge(arena, id);
  const w = useWallet();
  const now = useNow();
  const scan = useReveals(arena, ch);
  if (loading && !ch) return <Spinner label="Reading challenge…" />;
  if (error && !ch) {
    return (
      <div className="space-y-2">
        <p className="bad" role="alert">{error}</p>
        <button type="button" className="btn btn-sm" onClick={reload}>Retry</button>
      </div>
    );
  }
  if (!ch) return null;
  const info = describeSpec(ch.nIn, ch.nOut, ch.table);
  return (
    <div className="space-y-4">
      <a href="#/" className="inline-flex items-center gap-1 text-[var(--muted)] no-underline"><ArrowLeft size={14} /> all holes</a>
      <header className="space-y-2">
        <div className="label">Hole {String(ch.id).padStart(2, '0')}</div>
        <h1 className="text-xl font-bold">{info.name}</h1>
        <div className="flex flex-wrap items-center gap-2"><PhaseTag ch={ch} /><span className="text-[13px] text-[var(--muted)]">{ch.nIn} inputs, {ch.nOut} outputs</span></div>
      </header>

      <div className="sheet sheet-pad grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KV k="Pot">{fmtToken(ch.pot, ch.tokenDecimals, ch.tokenSymbol)}</KV>
        <KV k="Entries">{ch.commitCount}</KV>
        <KV k="Phase">{PHASES[ch.phase]}</KV>
        <KV k="Sponsor"><AddrLink address={ch.sponsor} /></KV>
        <KV k="Processor"><AddrLink address={ch.processor} /></KV>
        <KV k="Prize token"><AddrLink address={ch.token} /></KV>
      </div>

      <Deadlines ch={ch} now={now} />
      <Actions arena={arena} ch={ch} />
      <Leaderboard ch={ch} scan={scan} me={w.account} />

      <details className="sheet sheet-pad">
        <summary className="cursor-pointer font-bold">TRUTH TABLE <span className="label">{1 << ch.nIn} rows</span></summary>
        <div className="mt-3"><TruthTable nIn={ch.nIn} nOut={ch.nOut} table={ch.table} info={info} /></div>
        <p className="mt-2 text-[12px] text-[var(--muted)]">Input bits are listed in0 first. Your circuit must match every row; Arena checks them all when you reveal.</p>
      </details>
    </div>
  );
}
