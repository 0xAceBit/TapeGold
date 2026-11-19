import { Banknote } from 'lucide-react';
import { claim } from '@/mock/engine';
import { FEE_RECIPIENT, PERSONAS, personaName } from '@/mock/personas';
import { run } from '@/mock/store';
import type { ChainState, Persona } from '@/mock/types';
import { formatClock, formatToken } from '@/lib/format';

export function WalletPanel({ chain, persona }: { chain: ChainState; persona: Persona }) {
  const accounts = [...PERSONAS, FEE_RECIPIENT];
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <div>
        <h2 className="display text-3xl font-semibold">Balances and payouts</h2>
        <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
          Settling credits a payout. Anyone can send it on, but it always goes to the account it belongs to.
        </p>
      </div>

      <section className="card divide-y p-2" style={{ borderColor: 'var(--border)' }}>
        {accounts.map((a) => {
          const pending = chain.pending[a.address] ?? 0n;
          return (
            <div key={a.address} className="flex flex-wrap items-center gap-3 p-4" style={{ borderColor: 'var(--border)' }}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 font-semibold">
                  {a.name}
                  {a.address === persona.address && <span className="chip">you</span>}
                </div>
                <div className="text-xs" style={{ color: 'var(--muted)' }}>
                  {a.role}
                </div>
              </div>
              <div className="text-right text-sm">
                <div className="eyebrow">In wallet</div>
                <div className="num font-semibold">{formatToken(chain.balances[a.address] ?? 0n)}</div>
              </div>
              <div className="text-right text-sm">
                <div className="eyebrow">Waiting in contract</div>
                <div className="num font-semibold">{formatToken(pending)}</div>
              </div>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                disabled={pending === 0n}
                onClick={() => run(`Paid out to ${a.name}.`, (s) => claim(s, persona.address, a.address))}
              >
                <Banknote size={14} /> Pay out
              </button>
            </div>
          );
        })}
      </section>

      <section className="card p-6">
        <h3 className="display mb-3 text-lg font-semibold">Activity</h3>
        {chain.log.length === 0 ? (
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Nothing yet this session.
          </p>
        ) : (
          <ul className="space-y-2">
            {chain.log.slice(0, 12).map((l, i) => (
              <li key={i} className="flex gap-3 text-sm">
                <span className="num w-28 shrink-0 text-xs" style={{ color: 'var(--subtle)' }}>
                  {formatClock(l.at)}
                </span>
                <span>
                  <strong>{personaName(l.who)}</strong> {l.text}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
