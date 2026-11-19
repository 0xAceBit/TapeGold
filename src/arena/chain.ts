import { createPublicClient, custom, defineChain, type PublicClient } from 'viem';

/** X Layer mainnet. Sources: OKX X Layer docs and Chainstack (chain id, OKB, explorer); Multicall3 per the Chainstack chain table. */
export const XLAYER_ID = 196;
export const XLAYER_HEX = '0xc4';
export const XLAYER_RPC = 'https://rpc.xlayer.tech';
/** Build-time override, for testing the app against a local fork. Leave unset for production builds. */
export const RPC_URL: string = (import.meta.env?.VITE_RPC_URL as string | undefined) ?? XLAYER_RPC;
export const EXPLORER = 'https://www.oklink.com/xlayer';

export const xLayer = defineChain({
  id: XLAYER_ID,
  name: 'X Layer',
  nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
  rpcUrls: { default: { http: [XLAYER_RPC] } },
  blockExplorers: { default: { name: 'OKLink', url: EXPLORER } },
  contracts: { multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' } },
});

export const addressUrl = (a: string) => `${EXPLORER}/address/${a}`;
export const txUrl = (h: string) => `${EXPLORER}/tx/${h}`;

// --- rate-limited JSON-RPC transport -------------------------------------------------------------------------------
// The public endpoint answers "over rate limit" and refuses eth_getLogs ranges above 100 blocks (both observed against
// rpc.xlayer.tech). Every read goes through one queue with a request budget per second and retries on that error.

const MAX_PER_SECOND = 5;
const stamps: number[] = [];
let tail: Promise<void> = Promise.resolve();

function slot(): Promise<void> {
  const next = tail.then(async () => {
    for (;;) {
      const now = Date.now();
      while (stamps.length > 0 && now - (stamps[0] ?? 0) >= 1000) stamps.shift();
      if (stamps.length < MAX_PER_SECOND) {
        stamps.push(now);
        return;
      }
      await new Promise((r) => setTimeout(r, 1000 - (now - (stamps[0] ?? now)) + 20));
    }
  });
  tail = next;
  return next;
}

interface RpcError { code: number; message: string; data?: unknown }
let nextId = 1;

async function rpc(method: string, params: unknown): Promise<unknown> {
  for (let attempt = 0; attempt < 8; attempt++) {
    await slot();
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId++, method, params }),
    });
    const text = await res.text();
    let body: { result?: unknown; error?: RpcError } = {};
    try {
      body = JSON.parse(text) as typeof body;
    } catch {
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      throw new Error(`RPC returned a non-JSON response (HTTP ${res.status})`);
    }
    if (body.error) {
      if (/rate limit/i.test(body.error.message) || res.status === 429) {
        await new Promise((r) => setTimeout(r, 350 * (attempt + 1)));
        continue;
      }
      throw Object.assign(new Error(body.error.message), { code: body.error.code, data: body.error.data });
    }
    return body.result;
  }
  throw new Error('The X Layer RPC kept answering "over rate limit". Try again in a moment.');
}

let client: PublicClient | undefined;
/** One shared read client for the whole app. Reads never need a wallet. */
export function publicClient(): PublicClient {
  client ??= createPublicClient({
    chain: xLayer,
    transport: custom({ request: ({ method, params }: { method: string; params?: unknown }) => rpc(method, params) }),
    batch: { multicall: true },
  }) as PublicClient;
  return client;
}
