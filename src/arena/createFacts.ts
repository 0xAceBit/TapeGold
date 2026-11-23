import { isAddress, type Address } from 'viem';
import { arenaAbi } from './abi';
import { publicClient } from './chain';
import { erc20Abi, registryAbi } from './tapeout';

/** What the chain says about the token, the wallet and the processor, for the "create a challenge" form. All free read calls. */
export interface CreateFacts {
  tokenOk: boolean;
  symbol: string;
  decimals: number;
  balance: bigint;
  allowance: bigint;
  /** null while it could not be checked (bad address or no read yet). */
  processorOk: boolean | null;
}

export async function loadCreateFacts(arena: Address, token: string, processor: string, account: Address | null): Promise<CreateFacts> {
  const c = publicClient();
  const facts: CreateFacts = { tokenOk: false, symbol: '', decimals: 6, balance: 0n, allowance: 0n, processorOk: null };

  if (isAddress(token)) {
    try {
      const [symbol, decimals] = await Promise.all([
        c.readContract({ address: token, abi: erc20Abi, functionName: 'symbol' }),
        c.readContract({ address: token, abi: erc20Abi, functionName: 'decimals' }),
      ]);
      facts.tokenOk = true;
      facts.symbol = symbol;
      facts.decimals = decimals;
      if (account) {
        const [balance, allowance] = await Promise.all([
          c.readContract({ address: token, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
          c.readContract({ address: token, abi: erc20Abi, functionName: 'allowance', args: [account, arena] }),
        ]);
        facts.balance = balance;
        facts.allowance = allowance;
      }
    } catch {
      facts.tokenOk = false;
    }
  }

  if (isAddress(processor)) {
    try {
      const registry = await c.readContract({ address: arena, abi: arenaAbi, functionName: 'registry' });
      facts.processorOk = await c.readContract({ address: registry, abi: registryAbi, functionName: 'isCPU', args: [processor] });
    } catch {
      facts.processorOk = null;
    }
  }
  return facts;
}
