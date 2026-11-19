import { useCallback, useState } from 'react';
import type { Address, Hex } from 'viem';
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

/**
 * Sends one Arena transaction: switch to X Layer, simulate (so a revert costs nothing and is explained in words), sign,
 * wait for the receipt. `onSigned` runs right after the wallet returns a hash, before confirmation. Returns the hash, or
 * null after reporting the failure through `onStep`.
 */
export async function sendArenaTx(
  arena: Address,
  account: Address,
  functionName: Fn,
  args: readonly unknown[],
  onStep: (s: TxState) => void,
  onSigned?: (hash: Hex) => void,
): Promise<Hex | null> {
  try {
    onStep({ step: 'switching' });
    await ensureXLayer();
    onStep({ step: 'simulating' });
    const client = publicClient();
    const request = { address: arena, abi: arenaAbi, functionName, args, account } as never;
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

export function useArenaTx() {
  const [state, setState] = useState<TxState>({ step: 'idle' });
  const send = useCallback(
    (arena: Address, account: Address, functionName: Fn, args: readonly unknown[], onSigned?: (hash: Hex) => void) =>
      sendArenaTx(arena, account, functionName, args, setState, onSigned),
    [],
  );
  return { state, send, reset: () => setState({ step: 'idle' }) };
}
