import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, FileUp } from 'lucide-react';
import { parseEventLogs, type Address, type Hex } from 'viem';
import { arenaAbi } from '../abi';
import { preflight, type Preflight } from '../arena';
import { commitHash, findEntry, fromBackup, parseBackup, saveEntry } from '../backup';
import { publicClient } from '../chain';
import { utc } from '../format';
import { useChallenge, useMine } from '../hooks';
import { useArenaTx } from '../tx';
import { useWallet } from '../wallet';
import { CircuitCheck } from './CircuitCheck';
import { Note, Spinner, TxStatus } from './ui';

interface Secret { circuitId: bigint; salt: Hex; source: 'this browser' | 'backup file' }

export function RevealFlow({ arena, id }: { arena: Address; id: number }) {
  const { data: ch, loading } = useChallenge(arena, id);
  const w = useWallet();
  const mine = useMine(arena, ch, w.account);
  const tx = useArenaTx();
  const [imported, setImported] = useState<Secret | null>(null);
  const [paste, setPaste] = useState('');
  const [importError, setImportError] = useState<string | null>(null);
  const [pf, setPf] = useState<Preflight | null>(null);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<{ score: number; becameBest: boolean } | null>(null);
  const file = useRef<HTMLInputElement>(null);

  // Use the copy kept in this browser when there is one; a loaded backup file takes priority.
  const stored = useMemo<Secret | null>(() => {
    const e = w.account ? findEntry(arena, id, w.account) : undefined;
    return e ? { circuitId: BigInt(e.circuitId), salt: e.salt, source: 'this browser' } : null;
  }, [arena, id, w.account]);
  const secret = imported ?? stored;

  if (loading && !ch) return <Spinner label="Reading challenge…" />;
  if (!ch) return null;

  const commit = mine.data?.commit ?? null;
  const hashOk = !!(secret && w.account && commit && commitHash(secret.circuitId, secret.salt, w.account).toLowerCase() === commit.hash.toLowerCase());

  function importText(text: string) {
    try {
      const b = parseBackup(text);
      if (b.arena.toLowerCase() !== arena.toLowerCase()) throw new Error('That backup is for a different TapeGold contract.');
      if (Number(b.challengeId) !== id) throw new Error(`That backup is for challenge ${b.challengeId}, not ${id}.`);
      if (!w.account || b.account.toLowerCase() !== w.account.toLowerCase()) throw new Error('That backup belongs to a different wallet. Connect the wallet you committed with.');
      setImported({ circuitId: BigInt(b.circuitId), salt: b.salt, source: 'backup file' });
      saveEntry(fromBackup(b, 'committed'));
      setImportError(null);
      setPf(null);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : 'Could not read that backup.');
    }
  }

  async function check() {
    if (!secret || !w.account || !ch) return;
    setChecking(true);
    try {
      setPf(await preflight(arena, ch, secret.circuitId, w.account));
    } finally {
      setChecking(false);
    }
  }

  async function reveal() {
    if (!secret || !w.account) return;
    const hash = await tx.send(arena, w.account, 'reveal', [BigInt(id), secret.circuitId, secret.salt]);
    if (!hash) return;
    const e = findEntry(arena, id, w.account);
    if (e) saveEntry({ ...e, status: 'revealed', revealTx: hash });
    try {
      const receipt = await publicClient().getTransactionReceipt({ hash });
      const ev = parseEventLogs({ abi: arenaAbi, eventName: 'Revealed', logs: receipt.logs })[0];
      if (ev) setResult({ score: ev.args.score, becameBest: ev.args.becameBest });
    } catch {
      // the transaction is confirmed either way; the leaderboard will show it
    }
    mine.reload();
  }

  const open = ch.phase === 1;
  const sending = ['switching', 'simulating', 'signing', 'confirming'].includes(tx.state.step);
  const canReveal = open && !!commit && !commit.revealed && hashOk && pf?.ok === true && !sending && !result;

  return (
    <div className="space-y-4">
      <a href={`#/c/${id}`} className="inline-flex items-center gap-1 text-[var(--muted)] no-underline"><ArrowLeft size={14} /> hole {String(id).padStart(2, '0')}</a>
      <h1 className="text-xl font-bold">REVEAL YOUR ENTRY</h1>

      {!w.account && <Note tone="warn">Connect the wallet you committed with.</Note>}
      {ch.phase === 0 && <Note tone="warn">Reveals open when the commit phase ends ({utc(ch.commitEnd)}).</Note>}
      {ch.phase >= 2 && <Note tone="bad">The reveal window closed at {utc(ch.revealEnd)}. An unrevealed entry cannot win.</Note>}
      {w.account && mine.data && !commit && <Note tone="bad">This wallet has no commit in this challenge.</Note>}
      {commit?.revealed && <Note>You already revealed this entry. <a className="link" href={`#/c/${id}`}>See the leaderboard</a>.</Note>}

      {w.account && commit && !commit.revealed && (
        <>
          <section className="sheet sheet-pad space-y-3">
            <div className="label">Step 1 · your salt and circuit</div>
            {secret ? (
              <p className="text-[13px]">
                Loaded from {secret.source}: circuit <span className="num">{secret.circuitId.toString()}</span>.{' '}
                {hashOk ? <span className="ok">It matches your onchain commit.</span> : <span className="bad">It does NOT match your onchain commit.</span>}
              </p>
            ) : (
              <p className="text-[13px] text-[var(--muted)]">This browser has no saved entry. Load the backup file you downloaded when you committed.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn" onClick={() => file.current?.click()}><FileUp size={16} /> Load backup file</button>
              <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void f.text().then(importText);
                e.target.value = '';
              }} />
            </div>
            <textarea className="field num min-h-[88px] py-2 text-[12px]" placeholder="…or paste the backup text" value={paste}
              onChange={(e) => { setPaste(e.target.value); if (e.target.value.trim()) importText(e.target.value); }} spellCheck={false} />
            {importError && <p className="bad text-[13px]" role="alert">{importError}</p>}
            {secret && !hashOk && <Note tone="bad">Do not reveal with this data: the contract would reject it. Load the right backup.</Note>}
          </section>

          {secret && hashOk && (
            <section className="sheet sheet-pad space-y-3">
              <div className="label">Step 2 · check the circuit</div>
              <button type="button" className="btn" disabled={checking} onClick={() => void check()}>Run the check</button>
              {checking && <Spinner label="Running every row…" />}
              {pf && <CircuitCheck pf={pf} ch={ch} />}
            </section>
          )}

          <section className="sheet sheet-pad space-y-3">
            <div className="label">Step 3 · reveal</div>
            <p className="text-[13px] text-[var(--muted)]">
              The contract runs every row against your circuit. If one is wrong the transaction fails and nothing is lost but gas, but you cannot swap in a different circuit.
              {open ? ` Reveal closes at ${utc(ch.revealEnd)}.` : ''}
            </p>
            <button type="button" className="btn btn-primary w-full" disabled={!canReveal} onClick={() => void reveal()}>Reveal circuit</button>
            <TxStatus state={tx.state} />
            {result && (
              <Note>
                Revealed: {result.score} gates. {result.becameBest ? 'You are the leader right now.' : 'You are not the leader right now.'}{' '}
                <a className="link" href={`#/c/${id}`}>See the leaderboard</a>
              </Note>
            )}
          </section>
        </>
      )}
    </div>
  );
}
