import { useSyncExternalStore } from 'react';
import { createWalletClient, custom, getAddress, type Address, type WalletClient } from 'viem';
import { EXPLORER, XLAYER_HEX, XLAYER_ID, XLAYER_RPC, xLayer } from './chain';

export interface Eip1193 {
  request(args: { method: string; params?: unknown }): Promise<unknown>;
  on?(event: string, handler: (...args: never[]) => void): void;
  removeListener?(event: string, handler: (...args: never[]) => void): void;
}

declare global {
  interface Window {
    okxwallet?: Eip1193;
    ethereum?: Eip1193;
  }
}

export type WalletName = 'OKX Wallet' | 'Browser wallet';
interface Found { provider: Eip1193; name: WalletName }

/** OKX Wallet first (window.okxwallet), then any EIP-1193 provider (window.ethereum). */
export function findProvider(): Found | null {
  if (typeof window === 'undefined') return null;
  if (window.okxwallet?.request) return { provider: window.okxwallet, name: 'OKX Wallet' };
  if (window.ethereum?.request) return { provider: window.ethereum, name: 'Browser wallet' };
  return null;
}

export interface WalletState {
  status: 'idle' | 'connecting' | 'connected';
  account: Address | null;
  chainId: number | null;
  name: WalletName | null;
  error: string | null;
}

let state: WalletState = { status: 'idle', account: null, chainId: null, name: null, error: null };
const listeners = new Set<() => void>();
let bound: Eip1193 | null = null;
const REMEMBER = 'arena:v1:wallet';

function set(patch: Partial<WalletState>): void {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

export function useWallet(): WalletState {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
    () => state,
  );
}

interface ProviderError { code?: number; message?: string; data?: { originalError?: { code?: number } } }
const codeOf = (e: unknown): number | undefined => {
  const p = e as ProviderError;
  return p.data?.originalError?.code ?? p.code;
};
export function friendlyError(e: unknown): string {
  const p = e as ProviderError;
  if (codeOf(e) === 4001) return 'You rejected the request in your wallet.';
  if (codeOf(e) === -32002) return 'Your wallet already has a request open. Finish it there first.';
  return p.message ?? 'Something went wrong in the wallet.';
}

const parseChain = (v: unknown): number => (typeof v === 'string' ? parseInt(v, 16) : Number(v));

function bind(provider: Eip1193): void {
  if (bound === provider) return;
  bound = provider;
  provider.on?.('accountsChanged', ((accounts: string[]) => {
    const a = accounts[0];
    if (a) set({ account: getAddress(a), status: 'connected' });
    else {
      localStorage.removeItem(REMEMBER);
      set({ account: null, status: 'idle' });
    }
  }));
  provider.on?.('chainChanged', ((id: string) => set({ chainId: parseChain(id) })));
}

/** Switches the wallet to X Layer (196), adding the network first if the wallet does not know it. */
export async function ensureXLayer(): Promise<void> {
  const found = findProvider();
  if (!found) throw new Error('No wallet found.');
  const { provider } = found;
  const current = parseChain(await provider.request({ method: 'eth_chainId' }));
  if (current === XLAYER_ID) {
    set({ chainId: current });
    return;
  }
  try {
    await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: XLAYER_HEX }] });
  } catch (e) {
    const code = codeOf(e);
    if (code === 4001 || code === -32002) throw e;
    // 4902 (unknown chain) or a wallet that words it differently: add the network, then switch.
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: XLAYER_HEX,
          chainName: 'X Layer',
          nativeCurrency: { name: 'OKB', symbol: 'OKB', decimals: 18 },
          rpcUrls: [XLAYER_RPC],
          blockExplorerUrls: [EXPLORER],
        },
      ],
    });
    // Some wallets switch as part of adding; others only add. Ask for the switch again either way.
    const added = parseChain(await provider.request({ method: 'eth_chainId' }));
    if (added !== XLAYER_ID) await provider.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: XLAYER_HEX }] });
  }
  const after = parseChain(await provider.request({ method: 'eth_chainId' }));
  set({ chainId: after });
  if (after !== XLAYER_ID) throw new Error('Your wallet is still on another network. Switch to X Layer (chain 196) and try again.');
}

export async function connect(): Promise<void> {
  const found = findProvider();
  if (!found) {
    set({ error: 'No wallet found in this browser.' });
    return;
  }
  set({ status: 'connecting', error: null, name: found.name });
  try {
    bind(found.provider);
    const accounts = (await found.provider.request({ method: 'eth_requestAccounts' })) as string[];
    const a = accounts[0];
    if (!a) throw new Error('The wallet returned no account.');
    set({ account: getAddress(a), status: 'connected' });
    localStorage.setItem(REMEMBER, '1');
    await ensureXLayer();
  } catch (e) {
    set({ status: state.account ? 'connected' : 'idle', error: friendlyError(e) });
  }
}

export function disconnect(): void {
  localStorage.removeItem(REMEMBER);
  set({ status: 'idle', account: null, error: null });
}

/** Silent reconnect on page load (eth_accounts opens no popup). */
export async function restore(): Promise<void> {
  const found = findProvider();
  if (!found || !localStorage.getItem(REMEMBER)) return;
  try {
    bind(found.provider);
    const accounts = (await found.provider.request({ method: 'eth_accounts' })) as string[];
    const a = accounts[0];
    if (!a) return;
    const chainId = parseChain(await found.provider.request({ method: 'eth_chainId' }));
    set({ account: getAddress(a), status: 'connected', name: found.name, chainId });
  } catch {
    // stay disconnected
  }
}

/** A wallet client for sending transactions. Always call ensureXLayer() first. */
export function walletClient(): WalletClient {
  const found = findProvider();
  if (!found) throw new Error('No wallet found.');
  return createWalletClient({ chain: xLayer, transport: custom(found.provider) });
}
