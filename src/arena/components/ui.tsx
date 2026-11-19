import { useState, type ReactNode } from 'react';
import { Check, Copy, ExternalLink, Loader2 } from 'lucide-react';
import { addressUrl, txUrl } from '../chain';
import { shortAddr } from '../format';
import type { TxState } from '../tx';

export function Tag({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'ok' | 'warn' | 'bad' }) {
  const cls = tone === 'ok' ? 'ok' : tone === 'warn' ? 'warn' : tone === 'bad' ? 'bad' : '';
  return <span className={`tag ${cls}`}>{children}</span>;
}

export function KV({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="label">{k}</div>
      <div className="num truncate">{children}</div>
    </div>
  );
}

export function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-sm"
      onClick={() => {
        void navigator.clipboard
          .writeText(text)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
          .catch(() => undefined);
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? 'Copied' : label}
    </button>
  );
}

export function AddrLink({ address }: { address: string }) {
  return (
    <a className="link" href={addressUrl(address)} target="_blank" rel="noopener noreferrer" title={address}>
      {shortAddr(address)}
    </a>
  );
}

export function TxLink({ hash }: { hash: string }) {
  return (
    <a className="link inline-flex items-center gap-1" href={txUrl(hash)} target="_blank" rel="noopener noreferrer">
      {hash.slice(0, 10)}…{hash.slice(-6)} <ExternalLink size={12} />
    </a>
  );
}

export function Spinner({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-2 text-[var(--muted)]" role="status">
      <Loader2 size={14} className="animate-spin" /> {label}
    </span>
  );
}

const STEP_TEXT: Record<string, string> = {
  switching: 'Switching your wallet to X Layer…',
  simulating: 'Checking the transaction against the chain…',
  signing: 'Confirm in your wallet…',
  confirming: 'Waiting for confirmation…',
};

/** The one place every transaction's progress is shown. Driven only by real wallet and chain state. */
export function TxStatus({ state }: { state: TxState }) {
  if (state.step === 'idle') return null;
  if (state.step === 'error') return <p className="bad" role="alert">{state.message}</p>;
  if (state.step === 'done') {
    return (
      <p className="ok" role="status">
        Confirmed. <TxLink hash={state.hash} />
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <Spinner label={STEP_TEXT[state.step] ?? 'Working…'} />
      {state.step === 'confirming' && (
        <div className="text-[12px] text-[var(--muted)]">
          Sent: <TxLink hash={state.hash} />
        </div>
      )}
    </div>
  );
}

export function Note({ children, tone = 'plain' }: { children: ReactNode; tone?: 'plain' | 'warn' | 'bad' }) {
  const color = tone === 'bad' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--line-strong)';
  return (
    <div className="border-l-2 py-1 pl-3 text-[13px] text-[var(--muted)]" style={{ borderColor: color }}>
      {children}
    </div>
  );
}
