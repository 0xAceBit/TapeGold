import { useState } from 'react';
import { Plus } from 'lucide-react';
import { formatUnits, type Address } from 'viem';
import { arenaAbi } from '../abi';
import type { Challenge } from '../arena';
import { XLAYER_ID } from '../chain';
import { parsePot } from '../create';
import { loadCreateFacts } from '../createFacts';
import { usePoll } from '../hooks';
import { erc20Abi } from '../tapeout';
import { useTx } from '../tx';
import { connect, useWallet } from '../wallet';
import { Note, Spinner, TxStatus } from './ui';

/** Anyone can add to a challenge's prize until it is finalized. The addition goes to the winner; with no winner it can be claimed back. */
export function TopUp({ arena, ch, onDone }: { arena: Address; ch: Challenge; onDone: () => void }) {
  const w = useWallet();
  const approveTx = useTx();
  const topTx = useTx();
  const [amount, setAmount] = useState('0.1');
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);
  const facts = usePoll(() => loadCreateFacts(arena, ch.token, ch.processor, w.account), `topup:${arena}:${ch.id}:${w.account}`, 12_000);
  const f = facts.data;
  const base = f ? parsePot(amount, f.decimals) : null;
  const enough = !!f && base !== null && f.balance >= base;
  const allowed = !!f && base !== null && f.allowance >= base;
  const ready = !!w.account && !!f?.tokenOk && base !== null && enough && w.chainId === XLAYER_ID;

  async function approve() {
    if (!w.account || base === null) return;
    setBusy(true);
    try {
      if (await approveTx.send({ address: ch.token, abi: erc20Abi, functionName: 'approve', args: [arena, base] }, w.account)) facts.reload();
    } finally {
      setBusy(false);
    }
  }

  async function add() {
    if (!w.account || base === null || busy) return;
    setBusy(true);
    try {
      const hash = await topTx.send({ address: arena, abi: arenaAbi, functionName: 'topUp', args: [BigInt(ch.id), base] }, w.account);
      if (hash) {
        facts.reload();
        onDone();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="sheet sheet-pad space-y-3" aria-label="Add to the prize">
      <h2 className="text-base font-bold tracking-wide">ADD TO THE PRIZE</h2>
      <p className="text-[13px] text-[var(--muted)]">
        Anyone can make this pot bigger. It goes to the winner. If nobody enters a valid circuit, you can claim your part back after the challenge is finalized.
      </p>
      {!w.account ? (
        <button type="button" className="btn btn-sm" onClick={() => void connect()}>Connect a wallet to add</button>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-2">
            <label className="space-y-1 text-[13px]">Amount ({f?.symbol || ch.tokenSymbol})
              <input className="field field-sm num w-28" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={f ? base === null : undefined} />
            </label>
            {['0.1', '0.5', '1'].map((a) => (
              <button key={a} type="button" className="btn btn-sm" onClick={() => setAmount(a)}>{a}</button>
            ))}
          </div>
          {f && base === null && <p className="bad text-[13px]" role="alert">Enter an amount like 0.5 with at most {f.decimals} decimals.</p>}
          {f && base !== null && !enough && <p className="bad text-[13px]" role="alert">Your wallet holds {formatUnits(f.balance, f.decimals)} {f.symbol}, which is not enough.</p>}
          {facts.loading && <Spinner label="Reading your balance…" />}
          <label className="flex items-start gap-2 text-[13px]">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--accent)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
            <span>I understand this goes to the winner and I may not get it back.</span>
          </label>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-2">
              <button type="button" className="btn w-full" disabled={!ready || allowed || busy} onClick={() => void approve()}>
                {allowed ? 'Step 1 done: allowed' : 'Step 1: allow this amount'}
              </button>
              <TxStatus state={approveTx.state} />
            </div>
            <div className="space-y-2">
              <button type="button" className="btn btn-primary w-full" disabled={!ready || !allowed || !ack || busy} onClick={() => void add()}>
                <Plus size={14} /> Step 2: add to the prize
              </button>
              <TxStatus state={topTx.state} />
            </div>
          </div>
        </>
      )}
      <Note>Your wallet needs a little OKB for gas.</Note>
    </section>
  );
}
