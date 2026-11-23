import { useCallback, useState } from 'react';
import type { Abi, Address, Hex } from 'viem';
import { arenaAbi } from './abi';
import { publicClient } from './chain';
import { explain } from './errors';
import { ensureXLayer, walletClient } from './wallet';

export type TxState =
  | { step: 'idle' }
  | { step: 'switching' }
  | { step: 'simulating' }
  | { step: 'signing' }
  | { step: 'confirming'; hash: Hex }
  | { step: 'done'; hash: Hex }
  | { step: 'error'; message: string };

type Fn = 'commit' | 'reveal' | 'finalize' | 'withdraw' | 'claimRefund';

/** One contract call to simulate and send. */
export interface ContractCall {
  address: Address;
  abi: Abi | readonly unknown[];
  functionName: string;
  args: readonly unknown[];
}

/**
 * Sends one transaction: switch to X Layer, simulate (so a revert costs nothing and is explained in words), sign,
 * wait for the receipt. `onSigned` runs right after the wallet returns a hash, before confirmation. Returns the hash, or
 * null after reporting the failure through `onStep`.
 */
export async function sendContractTx(
  call: ContractCall,
  account: Address,
  onStep: (s: TxState) => void,
  onSigned?: (hash: Hex) => void,
): Promise<Hex | null> {
  try {
    onStep({ step: 'switching' });
    await ensureXLayer();
    onStep({ step: 'simulating' });
    const client = publicClient();
    const request = { ...call, account } as never;
    await client.simulateContract(request);
    onStep({ step: 'signing' });
    const hash = await walletClient().writeContract({ ...(request as object), chain: undefined } as never);
    onSigned?.(hash);
    onStep({ step: 'confirming', hash });
    const receipt = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
    if (receipt.status !== 'success') throw new Error('The transaction was mined but reverted.');
    onStep({ step: 'done', hash });
    return hash;
  } catch (e) {
    onStep({ step: 'error', message: explain(e) });
    return null;
  }
}

/** The same, for a call to the TapeGold contract. */
export function sendArenaTx(
  arena: Address,
  account: Address,
  functionName: Fn,
  args: readonly unknown[],
  onStep: (s: TxState) => void,
  onSigned?: (hash: Hex) => void,
): Promise<Hex | null> {
  return sendContractTx({ address: arena, abi: arenaAbi, functionName, args }, account, onStep, onSigned);
}

export function useArenaTx() {
  const [state, setState] = useState<TxState>({ step: 'idle' });
  const send = useCallback(
    (arena: Address, account: Address, functionName: Fn, args: readonly unknown[], onSigned?: (hash: Hex) => void) =>
      sendArenaTx(arena, account, functionName, args, setState, onSigned),
    [],
  );
  return { state, send, reset: () => setState({ step: 'idle' }) };
}

/** For any contract call (token approvals, challenge creation). */
export function useTx() {
  const [state, setState] = useState<TxState>({ step: 'idle' });
  const send = useCallback(
    (call: ContractCall, account: Address, onSigned?: (hash: Hex) => void) => sendContractTx(call, account, setState, onSigned),
    [],
  );
  return { state, send, reset: () => setState({ step: 'idle' }) };
}
