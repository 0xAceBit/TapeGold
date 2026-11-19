import { useState } from 'react';
import { clearOverride, saveOverride } from '../config';
import { Note } from './ui';

/** Live mode with no contract configured yet. No data is invented: the demo data is one click away in the header. */
export function Unconfigured() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <section className="sheet sheet-pad space-y-4">
      <h1 className="text-lg font-bold">No contract configured</h1>
      <p className="text-[var(--muted)]">
        Live mode reads one TapeGold contract on X Layer mainnet. Nothing is shown here until you point it at one. The demo data in the header shows the whole site meanwhile.
      </p>
      <ol className="list-decimal space-y-1 pl-5 text-[13px]">
        <li>Deploy the contract with the scripts in <span className="num">deployments/README.md</span>.</li>
        <li>Run <span className="num">bun scripts/xlayer-record.ts</span>. It writes <span className="num">public/config.json</span> with the address and deploy block.</li>
        <li>Rebuild and republish. <span className="num">config.json</span> is read at runtime, so you can also edit it in the published folder.</li>
      </ol>
      <div className="rule pt-4">
        <label className="label" htmlFor="addr">Or try an address in this browser only</label>
        <div className="mt-2 flex gap-2">
          <input id="addr" className="field num" placeholder="0x…" value={value} onChange={(e) => setValue(e.target.value)} spellCheck={false} autoCapitalize="off" />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (saveOverride(value)) location.reload();
              else setError('That is not a valid address.');
            }}
          >
            Use
          </button>
        </div>
        {error && <p className="bad mt-2 text-[13px]">{error}</p>}
        <div className="mt-3">
          <Note>
            Stored only in this browser. Check the address on OKLink before you trust it: a wrong contract can look identical.
          </Note>
        </div>
        <button type="button" className="mt-3 text-[12px] text-[var(--dim)] underline" onClick={() => { clearOverride(); location.reload(); }}>
          Clear saved address
        </button>
      </div>
    </section>
  );
}
