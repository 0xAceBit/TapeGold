// Exercises src/arena/wallet.ts and the transaction pipeline with a fake OKX Wallet that forwards to a LOCAL FORK.
//   VITE_RPC_URL=http://127.0.0.1:8546 ARENA=0x... ACCOUNT=0x... bun scripts/verify-wallet.ts
import { getAddress } from 'viem';

const store = new Map<string, string>();
const calls: string[] = [];
let chainId = '0x1'; // the wallet starts on the wrong network
let knowsXLayer = false; // and does not know X Layer yet, so adding it is part of the test
const RPC = process.env.VITE_RPC_URL ?? '';
const account = getAddress(process.env.ACCOUNT ?? '');

async function forward(method: string, params: unknown): Promise<unknown> {
  const res = await fetch(RPC, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  const j = (await res.json()) as { result?: unknown; error?: { message: string; code: number } };
  if (j.error) throw Object.assign(new Error(j.error.message), { code: j.error.code });
  return j.result;
}
const okx = {
  request: async ({ method, params }: { method: string; params?: unknown }): Promise<unknown> => {
    calls.push(method);
    if (method === 'eth_requestAccounts' || method === 'eth_accounts') return [account];
    if (method === 'eth_chainId') return chainId;
    if (method === 'wallet_switchEthereumChain') {
      if (!knowsXLayer) throw Object.assign(new Error('Unrecognized chain ID'), { code: 4902 });
      chainId = '0xc4';
      return null;
    }
    if (method === 'wallet_addEthereumChain') {
      const p = (params as { chainId: string; rpcUrls: string[] }[])[0];
      if (p?.chainId !== '0xc4' || !p.rpcUrls.includes('https://rpc.xlayer.tech')) throw new Error('bad add-chain parameters');
      knowsXLayer = true;
      return null;
    }
    return forward(method, params);
  },
  on: () => undefined,
};
Object.assign(globalThis, {
  window: globalThis,
  okxwallet: okx,
  ethereum: { request: () => Promise.reject(new Error('window.ethereum must not be used when okxwallet exists')) },
  localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) },
});

const { connect, findProvider, ensureXLayer } = await import('../src/arena/wallet');
const { sendArenaTx } = await import('../src/arena/tx');
const { readChallenge } = await import('../src/arena/arena');

let failures = 0;
const check = (n: string, ok: boolean, x = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${n}${x ? `  (${x})` : ''}`);
  if (!ok) failures++;
};
const arena = getAddress(process.env.ARENA ?? '');

check('OKX Wallet is chosen before window.ethereum', findProvider()?.name === 'OKX Wallet');
await connect();
check('connect switched an unknown, wrong network to X Layer (add then switch)', chainId === '0xc4' && calls.includes('wallet_addEthereumChain') && calls.indexOf('wallet_addEthereumChain') < calls.lastIndexOf('wallet_switchEthereumChain'), calls.join(' > '));
chainId = '0x1';
await ensureXLayer();
check('ensureXLayer switches back when the wallet drifts to another network', chainId === '0xc4');

delete (globalThis as { okxwallet?: unknown }).okxwallet;
Object.assign(globalThis, { ethereum: okx });
check('falls back to the generic EIP-1193 provider', findProvider()?.name === 'Browser wallet');
Object.assign(globalThis, { okxwallet: okx });

const steps: string[] = [];
const early = await readChallenge(arena, 1);
if (early.phase === 2) {
  const sent = await sendArenaTx(arena, account, 'finalize', [1n], (s) => steps.push(s.step));
  check('finalize goes through switch, simulate, sign, confirm', sent !== null && steps.join(' > ') === 'switching > simulating > signing > confirming > done', steps.join(' > '));
} else {
  console.log('SKIP  challenge 1 is already finalized on this fork (reset the fork to repeat this step)');
}
const after = await readChallenge(arena, 1);
check('challenge 1 is finalized onchain', after.phase === 3 && after.finalized);
const again: string[] = [];
const dup = await sendArenaTx(arena, account, 'finalize', [1n], (s) => again.push(s.step === 'error' ? `error: ${(s as { message: string }).message}` : s.step));
check('a second finalize is refused before signing, in words', dup === null && again.some((x) => x.startsWith('error: This challenge is already finalized')), again[again.length - 1] ?? '');
console.log(failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
