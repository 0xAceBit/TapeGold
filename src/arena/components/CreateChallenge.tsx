import { useState } from 'react';
import { ArrowLeft, Check, Circle, Plus } from 'lucide-react';
import { formatUnits, isAddress, parseEventLogs, type Address, type Hex } from 'viem';
import { arenaAbi } from '../abi';
import { chainNow } from '../arena';
import { publicClient, XLAYER_ID } from '../chain';
import {
  DEFAULT_PROCESSOR,
  MAX_FORM_INPUTS,
  MAX_FORM_OUTPUTS,
  NATIVE_USDC,
  PRESETS,
  packTable,
  parsePot,
  tableProblem,
  windowProblem,
} from '../create';
import { loadCreateFacts } from '../createFacts';
import { shortAddr, utc } from '../format';
import { useNow, usePoll } from '../hooks';
import { erc20Abi } from '../tapeout';
import { useTx } from '../tx';
import { connect, findProvider, useWallet } from '../wallet';
import { Note, Spinner, TxLink, TxStatus } from './ui';

const bitsLabel = (v: number, n: number) => Array.from({ length: n }, (_, i) => (v >> i) & 1).join(' ');

function Check1({ ok, children }: { ok: boolean | null; children: string }) {
  return (
    <li className="flex items-start gap-2 text-[13px]">
      {ok === true ? <Check size={14} className="mt-0.5 shrink-0 ok" /> : <Circle size={14} className={`mt-0.5 shrink-0 ${ok === false ? 'bad' : 'text-[var(--dim)]'}`} />}
      <span className={ok === false ? 'bad' : ok === true ? '' : 'text-[var(--muted)]'}>{children}</span>
    </li>
  );
}

/** Anyone with a wallet can post a challenge: pick or draw a puzzle, put in a prize, and it goes onchain. */
export function CreateChallenge({ arena }: { arena: Address }) {
  const w = useWallet();
  const now = useNow();
  const approveTx = useTx();
  const createTx = useTx();

  const [presetId, setPresetId] = useState('and');
  const [custom, setCustom] = useState({ nIn: 2, nOut: 1, rows: [0, 0, 0, 0] });
  const [pot, setPot] = useState('1');
  const [commitH, setCommitH] = useState('48');
  const [revealH, setRevealH] = useState('48');
  const [token, setToken] = useState<string>(NATIVE_USDC);
  const [processor, setProcessor] = useState<string>(DEFAULT_PROCESSOR);
  const [advanced, setAdvanced] = useState(false);
  const [ack, setAck] = useState(false);
  const [created, setCreated] = useState<{ id: number | null; hash: Hex } | null>(null);
  const [busy, setBusy] = useState(false);

  const preset = PRESETS.find((p) => p.id === presetId);
  const spec = preset ?? { id: 'custom', name: 'Your own puzzle', blurb: 'Draw the answer sheet yourself.', nIn: custom.nIn, nOut: custom.nOut, expected: custom.rows };

  const facts = usePoll(() => loadCreateFacts(arena, token, processor, w.account), `create:${arena}:${token}:${processor}:${w.account}`, 12_000);
  const f = facts.data;
  const potBase = f ? parsePot(pot, f.decimals) : null;
  const tableErr = tableProblem(spec.nIn, spec.nOut, spec.expected);
  const windowErr = windowProblem(Number(commitH), Number(revealH));
  const enough = !!f && potBase !== null && f.balance >= potBase;
  const allowed = !!f && potBase !== null && f.allowance >= potBase;
  const baseReady = !!w.account && !!f?.tokenOk && potBase !== null && enough && !tableErr && !windowErr && f.processorOk === true && isAddress(token) && isAddress(processor);
  const wrongChain = w.status === 'connected' && w.chainId !== XLAYER_ID;

  const setDims = (nIn: number, nOut: number) =>
    setCustom((c) => ({ nIn, nOut, rows: Array.from({ length: 2 ** nIn }, (_, v) => (c.rows[v] ?? 0) & (2 ** nOut - 1)) }));
  const toggle = (v: number, j: number) => setCustom((c) => ({ ...c, rows: c.rows.map((r, i) => (i === v ? r ^ (1 << j) : r)) }));

  async function approve() {
    if (!w.account || potBase === null) return;
    setBusy(true);
    try {
      // Allow exactly this prize, nothing more.
      const hash = await approveTx.send({ address: token as Address, abi: erc20Abi, functionName: 'approve', args: [arena, potBase] }, w.account);
      if (hash) facts.reload();
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!w.account || potBase === null || busy) return;
    setBusy(true);
    try {
      const now = await chainNow();
      const commitEnd = BigInt(now + Number(commitH) * 3600);
      const revealEnd = commitEnd + BigInt(Number(revealH) * 3600);
      const hash = await createTx.send(
        {
          address: arena,
          abi: arenaAbi,
          functionName: 'createChallenge',
          args: [token, potBase, spec.nIn, spec.nOut, packTable(spec.nIn, spec.nOut, spec.expected), commitEnd, revealEnd, processor],
        },
        w.account,
      );
      if (hash) {
        const receipt = await publicClient().getTransactionReceipt({ hash });
        const made = parseEventLogs({ abi: arenaAbi, eventName: 'ChallengeCreated', logs: receipt.logs }).find((l) => l.address.toLowerCase() === arena.toLowerCase());
        setCreated({ id: made ? Number(made.args.challengeId) : null, hash });
        facts.reload();
      }
    } finally {
      setBusy(false);
    }
  }

  if (created) {
    return (
      <section className="sheet sheet-pad space-y-3">
        <h1 className="text-lg font-bold">Challenge {created.id !== null ? `#${created.id} ` : ''}is live</h1>
        <p className="text-[var(--muted)]">
          Your prize is held by the contract. Players build a circuit on the processor, then enter before the entry window closes.
        </p>
        <p className="text-[13px]">Transaction: <TxLink hash={created.hash} /></p>
        <div className="flex flex-wrap gap-2">
          {created.id !== null && <a className="btn btn-primary" href={`#/c/${created.id}`}>Open the challenge</a>}
          <a className="btn" href="#/">Back to the scorecard</a>
        </div>
      </section>
    );
  }

  const symbol = f?.symbol || 'USDC';
  return (
    <section className="space-y-4">
      <a href="#/" className="inline-flex items-center gap-1 text-[13px] text-[var(--muted)] no-underline"><ArrowLeft size={14} /> Scorecard</a>
      <div>
        <h1 className="text-lg font-bold">Create a challenge</h1>
        <p className="text-[var(--muted)]">Post a puzzle and a prize. Anyone can enter. The fewest gates wins the pot.</p>
      </div>

      <div className="sheet sheet-pad space-y-3">
        <span className="label">1. The puzzle</span>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Puzzle">
          {[...PRESETS.map((p) => ({ id: p.id, name: p.name })), { id: 'custom', name: 'Draw my own' }].map((p) => (
            <button key={p.id} type="button" className="btn btn-sm" aria-pressed={presetId === p.id} style={presetId === p.id ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : undefined} onClick={() => setPresetId(p.id)}>
              {p.name}
            </button>
          ))}
        </div>
        <p className="text-[13px] text-[var(--muted)]">{spec.blurb}</p>
        {presetId === 'custom' ? (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-3 text-[13px]">
              <label className="flex items-center gap-2">Switches
                <select className="field field-sm w-20" value={custom.nIn} onChange={(e) => setDims(Number(e.target.value), custom.nOut)}>
                  {Array.from({ length: MAX_FORM_INPUTS }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
              <label className="flex items-center gap-2">Lamps
                <select className="field field-sm w-20" value={custom.nOut} onChange={(e) => setDims(custom.nIn, Number(e.target.value))}>
                  {Array.from({ length: MAX_FORM_OUTPUTS }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
                </select>
              </label>
            </div>
            <div className="max-h-72 overflow-auto border border-[var(--line)]">
              <table className="num w-full border-collapse text-[13px]">
                <thead className="sticky top-0 bg-[var(--panel-2)]"><tr className="label"><th className="px-3 py-2 text-left font-normal">switches (in0 first)</th><th className="px-3 py-2 text-left font-normal">lamps: tap to turn on</th></tr></thead>
                <tbody>
                  {custom.rows.map((r, v) => (
                    <tr key={v} className="border-t border-[var(--line)]">
                      <td className="px-3 py-1.5">{bitsLabel(v, custom.nIn)}</td>
                      <td className="px-3 py-1.5">
                        <span className="flex gap-1.5">
                          {Array.from({ length: custom.nOut }, (_, j) => (
                            <button key={j} type="button" className="btn btn-sm w-10" aria-pressed={((r >> j) & 1) === 1} aria-label={`row ${v} lamp ${j}`} style={((r >> j) & 1) === 1 ? { background: 'var(--accent)', color: '#fff', borderColor: 'var(--accent)' } : undefined} onClick={() => toggle(v, j)}>
                              {(r >> j) & 1}
                            </button>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <div className="max-h-48 overflow-auto border border-[var(--line)]">
            <table className="num w-full border-collapse text-[13px]">
              <thead className="sticky top-0 bg-[var(--panel-2)]"><tr className="label"><th className="px-3 py-2 text-left font-normal">switches</th><th className="px-3 py-2 text-left font-normal">lamps</th></tr></thead>
              <tbody>
                {spec.expected.map((e, v) => (
                  <tr key={v} className="border-t border-[var(--line)]"><td className="px-3 py-1.5">{bitsLabel(v, spec.nIn)}</td><td className="px-3 py-1.5">{bitsLabel(e, spec.nOut)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tableErr && <p className="bad text-[13px]" role="alert">{tableErr}</p>}
      </div>

      <div className="sheet sheet-pad space-y-3">
        <span className="label">2. The prize and the timing</span>
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-[13px]">Prize ({symbol})
            <input className="field num" inputMode="decimal" value={pot} onChange={(e) => setPot(e.target.value)} aria-invalid={f ? potBase === null : undefined} />
          </label>
          <label className="space-y-1 text-[13px]">Entry window (hours)
            <input className="field num" inputMode="numeric" value={commitH} onChange={(e) => setCommitH(e.target.value)} />
          </label>
          <label className="space-y-1 text-[13px]">Reveal window (hours)
            <input className="field num" inputMode="numeric" value={revealH} onChange={(e) => setRevealH(e.target.value)} />
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          {['0.1', '0.5', '1', '5'].map((a) => <button key={a} type="button" className="btn btn-sm" onClick={() => setPot(a)}>{a}</button>)}
        </div>
        {windowErr && <p className="bad text-[13px]" role="alert">{windowErr}</p>}
        <p className="text-[12px] text-[var(--muted)]">
          Entries open now and close after the entry window. Reveals then run for the reveal window. After that anyone can finalize and the winner is paid.
        </p>
      </div>

      <div className="sheet sheet-pad space-y-3">
        <button type="button" className="label text-left underline" aria-expanded={advanced} onClick={() => setAdvanced((a) => !a)}>
          {advanced ? 'Hide' : 'Show'} advanced: token and processor
        </button>
        {advanced && (
          <div className="space-y-3">
            <label className="block space-y-1 text-[13px]">Prize token address
              <input className="field num" value={token} onChange={(e) => setToken(e.target.value.trim())} spellCheck={false} />
            </label>
            {token.toLowerCase() !== NATIVE_USDC.toLowerCase() && (
              <Note tone="warn">This is not the standard USDC. Anyone can make a token with any name. Players will see a "custom token" warning, so only use a token you trust. Tokens that take a fee on transfer are rejected.</Note>
            )}
            <label className="block space-y-1 text-[13px]">Processor address (where players create their circuits)
              <input className="field num" value={processor} onChange={(e) => setProcessor(e.target.value.trim())} spellCheck={false} />
            </label>
            <Note>The processor must be registered with TapeOut. Its owner decides who may create circuits on it, so pick one that is open to everyone.</Note>
          </div>
        )}
        <ul className="space-y-1.5">
          <Check1 ok={w.account ? true : null}>{w.account ? `Wallet connected (${shortAddr(w.account)})` : 'Connect a wallet'}</Check1>
          <Check1 ok={wrongChain ? false : w.account ? true : null}>{wrongChain ? 'Your wallet is on another network: it will be switched to X Layer when you send' : 'Wallet on X Layer'}</Check1>
          <Check1 ok={f ? f.tokenOk : null}>{f?.tokenOk ? `Token ${f.symbol} found` : 'Token found'}</Check1>
          <Check1 ok={f && potBase !== null && w.account ? enough : null}>
            {f && w.account ? `Balance ${formatUnits(f.balance, f.decimals)} ${f.symbol}${potBase !== null && !enough ? ' is less than the prize' : ''}` : 'Balance covers the prize'}
          </Check1>
          <Check1 ok={f ? f.processorOk : null}>{f?.processorOk === false ? 'That processor is not registered with TapeOut' : 'Processor is registered with TapeOut'}</Check1>
        </ul>
      </div>

      <div className="sheet sheet-pad space-y-3">
        <span className="label">3. Send it</span>
        {!w.account ? (
          <div className="space-y-2">
            <button type="button" className="btn btn-primary" disabled={w.status === 'connecting'} onClick={() => void connect()}>
              {w.status === 'connecting' ? 'Connecting…' : findProvider()?.name === 'OKX Wallet' ? 'Connect OKX Wallet' : 'Connect wallet'}
            </button>
            {!findProvider() && <Note>No wallet found in this browser. Open this page in the OKX Wallet app browser or a desktop browser with the OKX Wallet extension.</Note>}
          </div>
        ) : (
          <>
            <Note tone="warn">
              The prize is locked in the contract and goes to whoever wins. You cannot take it back, except if nobody enters a valid circuit. Anyone may add to it.
            </Note>
            <label className="flex items-start gap-2 text-[13px]">
              <input type="checkbox" className="mt-0.5 h-5 w-5 accent-[var(--accent)]" checked={ack} onChange={(e) => setAck(e.target.checked)} />
              <span>I understand. I am putting {potBase !== null && f ? `${formatUnits(potBase, f.decimals)} ${f.symbol}` : 'this prize'} into this challenge for anyone to win.</span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <button type="button" className="btn w-full" disabled={!baseReady || allowed || busy} onClick={() => void approve()}>
                  {allowed ? 'Step 1 done: USDC allowed' : `Step 1: allow ${potBase !== null && f ? formatUnits(potBase, f.decimals) : ''} ${symbol}`}
                </button>
                <TxStatus state={approveTx.state} />
              </div>
              <div className="space-y-2">
                <button type="button" className="btn btn-primary w-full" disabled={!baseReady || !allowed || !ack || busy} onClick={() => void create()}>
                  Step 2: create the challenge
                </button>
                <TxStatus state={createTx.state} />
              </div>
            </div>
            {facts.loading && <Spinner label="Reading the chain…" />}
            {baseReady && (
              <p className="text-[12px] text-[var(--muted)]">
                Entries close about {utc(now + Number(commitH) * 3600)}. Reveals close about {utc(now + (Number(commitH) + Number(revealH)) * 3600)}.
              </p>
            )}
          </>
        )}
      </div>
      <p className="text-[12px] text-[var(--dim)]"><Plus size={11} className="inline" /> Creating a challenge costs a little OKB for gas. Ties go to whoever entered first.</p>
    </section>
  );
}
