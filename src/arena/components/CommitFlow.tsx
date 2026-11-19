import { useRef, useState } from 'react';
import { ArrowLeft, Download, FileUp, Lock } from 'lucide-react';
import type { Address } from 'viem';
import { arenaAbi } from '../abi';
import { preflight, type Challenge, type Preflight } from '../arena';
import { publicClient } from '../chain';
import { commitHash, downloadBackup, fromBackup, generateSalt, makeBackup, parseBackup, saveEntry, serializeBackup, type Backup } from '../backup';
import { utc } from '../format';
import { useChallenge, useMine } from '../hooks';
import { useArenaTx } from '../tx';
import { useWallet } from '../wallet';
import { CircuitCheck } from './CircuitCheck';
import { CopyButton, Note, Spinner, TxStatus } from './ui';

const sameBackup = (a: Backup, b: Backup) =>
  a.salt === b.salt && a.commitHash.toLowerCase() === b.commitHash.toLowerCase() && a.circuitId === b.circuitId && a.challengeId === b.challengeId &&
  a.account.toLowerCase() === b.account.toLowerCase() && a.arena.toLowerCase() === b.arena.toLowerCase();

export function CommitFlow({ arena, id }: { arena: Address; id: number }) {
  const { data: ch, loading } = useChallenge(arena, id);
  const w = useWallet();
  const mine = useMine(arena, ch, w.account);
  const tx = useArenaTx();

  const [circuitText, setCircuitText] = useState('');
  const [pfRaw, setPf] = useState<Preflight | null>(null);
  const [pfFor, setPfFor] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [checking, setChecking] = useState(false);
  const [rawBackup, setBackup] = useState<Backup | null>(null);
  const [downloadedFor, setDownloadedFor] = useState<string | null>(null);
  const [verifiedFor, setVerifiedFor] = useState<string | null>(null);
  const [paste, setPaste] = useState('');
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [committed, setCommitted] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  function startOver() {
    setBackup(null);
    setDownloadedFor(null);
    setVerifiedFor(null);
    setPaste('');
    setVerifyError(null);
    setSaveNote(null);
  }

  if (loading && !ch) return <Spinner label="Reading challenge…" />;
  if (!ch) return null;

  // A different wallet account means a different commit hash, so a backup made for another account is ignored.
  const backup = rawBackup && w.account && rawBackup.account.toLowerCase() === w.account.toLowerCase() ? rawBackup : null;
  const downloaded = !!backup && downloadedFor === backup.commitHash;
  const verified = !!backup && verifiedFor === backup.commitHash;
  // A check made for another wallet account says nothing about this one.
  const pf = pfRaw && w.account && pfFor === w.account.toLowerCase() ? pfRaw : null;
  const circuitId = /^\d+$/.test(circuitText.trim()) ? BigInt(circuitText.trim()) : null;
  const existing = mine.data?.commit ?? null;
  const open = ch.phase === 0;

  async function check() {
    if (circuitId === null || !w.account || !ch) return;
    setChecking(true);
    setPf(null);
    setPfFor(w.account.toLowerCase());
    try {
      setPf(await preflight(arena, ch, circuitId, w.account));
    } catch (e) {
      setPf({ owner: null, ownerOk: false, exists: false, shapeOk: false, statefulOk: false, gates: 0, budgetOk: false, rows: [], rowsOk: false, ok: false, problem: e instanceof Error ? e.message : 'Check failed.' });
    } finally {
      setChecking(false);
    }
  }

  function createBackup() {
    if (circuitId === null || !w.account) return;
    const b = makeBackup({ arena, challengeId: id, circuitId, salt: generateSalt(), account: w.account });
    setBackup(b);
    // Put a copy in this browser right away. It is a convenience only: browsers clear storage, the file is the real backup.
    saveEntry(fromBackup(b, 'pending'));
  }

  function verifyFrom(text: string) {
    if (!backup) return;
    try {
      const parsed = parseBackup(text);
      if (!sameBackup(parsed, backup)) throw new Error('That backup is for a different circuit, challenge or wallet than the one you are about to commit.');
      setVerifiedFor(backup.commitHash);
      setVerifyError(null);
    } catch (e) {
      setVerifiedFor(null);
      setVerifyError(e instanceof Error ? e.message : 'Could not read that backup.');
    }
  }

  async function commit() {
    if (!backup || !w.account || !ch || starting) return;
    setStarting(true);
    try {
      await commitNow(backup, w.account, ch);
    } finally {
      setStarting(false);
    }
  }

  async function commitNow(backup: Backup, account: Address, ch: Challenge) {
    void ch;
    // Belt and braces: the contract must compute the same hash we are about to commit.
    const onchain = await publicClient().readContract({ address: arena, abi: arenaAbi, functionName: 'commitHashOf', args: [BigInt(backup.circuitId), backup.salt, account] });
    if (onchain.toLowerCase() !== commitHash(BigInt(backup.circuitId), backup.salt, account).toLowerCase()) {
      setVerifyError('Internal check failed: the contract computes a different hash. Nothing was sent.');
      return;
    }
    saveEntry(fromBackup(backup, 'pending'));
    const hash = await tx.send(arena, account, 'commit', [BigInt(id), backup.commitHash], (h) => saveEntry({ ...fromBackup(backup, 'pending'), commitTx: h }));
    if (hash) {
      saveEntry({ ...fromBackup(backup, 'committed'), commitTx: hash });
      setCommitted(true);
      mine.reload();
    }
  }

  const sending = ['switching', 'simulating', 'signing', 'confirming'].includes(tx.state.step);
  const canCommit = open && !!w.account && !existing && !!backup && downloaded && verified && !sending && !starting && !committed && pf?.ok === true;

  return (
    <div className="space-y-4">
      <a href={`#/c/${id}`} className="inline-flex items-center gap-1 text-[var(--muted)] no-underline"><ArrowLeft size={14} /> hole {String(id).padStart(2, '0')}</a>
      <h1 className="text-xl font-bold">COMMIT AN ENTRY</h1>

      {!open && <Note tone="bad">The commit phase is over ({utc(ch.commitEnd)}). You can no longer enter this challenge.</Note>}
      {!w.account && <Note tone="warn">Connect your wallet first. The circuit you commit must be owned by it.</Note>}
      {existing && (
        <Note tone="warn">
          This wallet already committed (commit #{existing.index}). Each wallet gets one commit per challenge. <a className="link" href={`#/c/${id}/reveal`}>Go to reveal</a>.
        </Note>
      )}

      {open && w.account && !mine.data && <Spinner label="Checking whether this wallet already committed…" />}
      {open && w.account && !!mine.data && !existing && (
        <>
          <section className="sheet sheet-pad space-y-3">
            <div className="label">Step 1 · your circuit</div>
            <p className="text-[13px] text-[var(--muted)]">
              Enter the id of a circuit you already taped out on this challenge's processor. The check below runs every truth-table row against it for free.
            </p>
            <div className="flex gap-2">
              <input className="field num" inputMode="numeric" placeholder="circuit id, e.g. 8" value={circuitText} disabled={!!backup}
                onChange={(e) => { setCircuitText(e.target.value); setPf(null); }} aria-label="Circuit id" />
              <button type="button" className="btn" disabled={circuitId === null || checking || !!backup} onClick={() => void check()}>Check</button>
            </div>
            {checking && <Spinner label="Running every row against your circuit…" />}
            {pf && <CircuitCheck pf={pf} ch={ch} />}
          </section>

          {pf?.ok && (
            <section className="sheet sheet-pad space-y-3">
              <div className="label">Step 2 · salt and backup</div>
              <Note tone="warn">
                Your salt is generated in this browser and never sent anywhere. <strong className="text-[var(--ink)]">If you lose it you cannot reveal, and the entry is lost.</strong>{' '}
                Nobody, including us, can recover it.
              </Note>
              {!backup ? (
                <button type="button" className="btn btn-primary" onClick={createBackup}><Lock size={16} /> Generate my salt</button>
              ) : (
                <div className="space-y-3">
                  <div className="text-[12px] text-[var(--muted)] break-all">
                    Commit hash: <span className="num text-[var(--ink)]">{backup.commitHash}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button" className="btn btn-primary" onClick={() => {
                      const ok = downloadBackup(backup);
                      setDownloadedFor(ok ? backup.commitHash : null);
                      setSaveNote(ok ? 'Download started. Find the file, then verify it in step 3.' : 'Your browser could not create a download. Use Copy and save the text yourself.');
                    }}>
                      <Download size={16} /> Download backup file
                    </button>
                    <CopyButton text={serializeBackup(backup)} label="Copy backup text" />
                    <button type="button" className="btn btn-sm" onClick={startOver}>Start over</button>
                  </div>
                  {saveNote && <p className="text-[13px] text-[var(--muted)]">{saveNote}</p>}
                  <p className="text-[12px] text-[var(--muted)]">
                    In some wallet browsers downloads do not work. In that case copy the text into a notes app or a password manager, then paste it back in step 3.
                    If you copied it instead of downloading, tick the box:
                  </p>
                  <label className="flex min-h-[44px] items-center gap-3 text-[13px]">
                    <input type="checkbox" className="h-5 w-5 accent-[var(--accent)]" checked={downloaded} onChange={(e) => setDownloadedFor(e.target.checked ? backup.commitHash : null)} />
                    I have saved the backup somewhere outside this page.
                  </label>
                </div>
              )}
            </section>
          )}

          {backup && (
            <section className="sheet sheet-pad space-y-3">
              <div className="label">Step 3 · prove the backup works</div>
              <p className="text-[13px] text-[var(--muted)]">
                The commit button stays locked until you load your saved backup back in. This catches a file that failed to save before it is too late.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn" onClick={() => file.current?.click()}><FileUp size={16} /> Choose the saved file</button>
                <input ref={file} type="file" accept=".json,application/json" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void f.text().then(verifyFrom);
                  e.target.value = '';
                }} />
              </div>
              <textarea className="field num min-h-[88px] py-2 text-[12px]" placeholder="…or paste the backup text here" value={paste}
                onChange={(e) => { setPaste(e.target.value); if (e.target.value.trim()) verifyFrom(e.target.value); }} spellCheck={false} />
              {verified && <p className="ok" role="status">Backup verified. It matches this entry exactly.</p>}
              {verifyError && <p className="bad text-[13px]" role="alert">{verifyError}</p>}
            </section>
          )}

          <section className="sheet sheet-pad space-y-3">
            <div className="label">Step 4 · commit</div>
            <p className="text-[13px] text-[var(--muted)]">
              This publishes only a hash. Your circuit stays hidden until the reveal phase. One commit per wallet, and it cannot be changed.
            </p>
            <button type="button" className="btn btn-primary w-full" disabled={!canCommit} onClick={() => void commit()}>
              {committed ? 'Committed' : 'Commit entry'}
            </button>
            {!canCommit && !committed && (
              <p className="text-[12px] text-[var(--dim)]">
                Locked until: circuit checked {pf?.ok ? '✓' : '✗'} · salt generated {backup ? '✓' : '✗'} · backup saved {downloaded ? '✓' : '✗'} · backup verified {verified ? '✓' : '✗'}
              </p>
            )}
            <TxStatus state={tx.state} />
            {committed && (
              <Note>
                Entry sealed. Keep your backup file. Reveal opens at {utc(ch.commitEnd)} and closes at {utc(ch.revealEnd)}. <a className="link" href={`#/c/${id}`}>Back to the hole</a>
              </Note>
            )}
          </section>
        </>
      )}
    </div>
  );
}
