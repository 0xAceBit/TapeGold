import { useEffect, type ReactNode } from 'react';
import { ExternalLink, Wallet } from 'lucide-react';
import { EXPLORER, XLAYER_ID, addressUrl } from '../chain';
import type { ArenaConfig } from '../config';
import { shortAddr } from '../format';
import { connect, disconnect, ensureXLayer, findProvider, friendlyError, restore, useWallet } from '../wallet';
import { Brand } from '../../components/Brand';
import { CopyButton } from './ui';

function WalletButton() {
  const w = useWallet();
  useEffect(() => {
    void restore();
  }, []);
  if (w.status === 'connected' && w.account) {
    return (
      <button type="button" className="btn btn-sm" onClick={disconnect} title="Disconnect (this only forgets the account in this page)">
        <Wallet size={14} /> {shortAddr(w.account)}
      </button>
    );
  }
  return (
    <button type="button" className="btn btn-sm btn-primary" disabled={w.status === 'connecting'} onClick={() => void connect()}>
      <Wallet size={14} /> {w.status === 'connecting' ? 'Connecting…' : findProvider()?.name === 'OKX Wallet' ? 'Connect OKX Wallet' : 'Connect wallet'}
    </button>
  );
}

function WalletNotices() {
  const w = useWallet();
  const found = findProvider();
  return (
    <div className="space-y-2">
      {w.error && <p className="bad text-[13px]" role="alert">{w.error}</p>}
      {w.status === 'connected' && w.chainId !== null && w.chainId !== XLAYER_ID && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--warn)] p-3 text-[13px]">
          <span className="warn">Your wallet is on chain {w.chainId}. TapeGold runs on X Layer ({XLAYER_ID}).</span>
          <button
            type="button"
            className="btn btn-sm"
            onClick={() => void ensureXLayer().catch((e: unknown) => alert(friendlyError(e)))}
          >
            Switch to X Layer
          </button>
        </div>
      )}
      {!found && (
        <div className="card p-3 text-[13px] text-[var(--muted)]">
          No wallet detected in this browser. Reading works without one. To enter a challenge, open this page in the OKX Wallet app browser
          or a desktop browser with the OKX Wallet extension.
        </div>
      )}
    </div>
  );
}

/** Contract strip: shown on every screen, always visible. */
function ContractBar({ config }: { config: ArenaConfig }) {
  return (
    <footer className="fixed inset-x-0 bottom-0 z-20 border-t backdrop-blur-xl" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.88)' }} aria-label="Contract">
      <div className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-[12px]">
        <span className="label">TapeGold contract</span>
        {config.arena ? (
          <>
            <a className="link num" href={addressUrl(config.arena)} target="_blank" rel="noopener noreferrer" title={config.arena}>
              {shortAddr(config.arena)}
            </a>
            <CopyButton text={config.arena} label="Copy" />
            <a className="btn btn-sm" href={addressUrl(config.arena)} target="_blank" rel="noopener noreferrer">
              OKLink <ExternalLink size={12} />
            </a>
          </>
        ) : (
          <>
            <span className="warn">not configured</span>
            <a className="btn btn-sm" href={EXPLORER} target="_blank" rel="noopener noreferrer">
              OKLink <ExternalLink size={12} />
            </a>
          </>
        )}
        <span className="ml-auto text-[var(--dim)]">X Layer {XLAYER_ID}</span>
      </div>
    </footer>
  );
}

export function Shell({ config, modeSwitch, children }: { config: ArenaConfig; modeSwitch?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh pb-28">
      <header className="sticky top-0 z-10 border-b backdrop-blur-xl" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.92)' }}>
        <div className="mx-auto flex max-w-3xl flex-wrap items-center justify-between gap-x-3 gap-y-2 px-4 py-3">
          <a href="#/" className="no-underline" style={{ color: 'var(--ink)' }} aria-label="TapeGold home">
            <Brand />
          </a>
          <div className="flex flex-wrap items-center gap-2">
            {modeSwitch}
            <WalletButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl space-y-4 px-4 py-5">
        <WalletNotices />
        {children}
      </main>
      <ContractBar config={config} />
    </div>
  );
}
