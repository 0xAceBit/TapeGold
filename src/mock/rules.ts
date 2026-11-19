// Contract rules mirrored from contracts/TapeGolf.sol so the mock engine rejects exactly what the contract rejects.
// When live wiring starts, read these from the deployed contract instead of keeping a copy.

export const RULES = {
  MAX_INPUTS: 8,
  MAX_OUTPUTS: 8,
  MAX_NETLIST_BYTES: 4096,
  BYTES_PER_GATE: 7,
  MIN_PHASE_SECONDS: 3600,
  MAX_FEE_BPS: 500,
  EVAL_GAS_BUDGET: 60_000_000,
  GAS_PER_EVAL_BASE: 10_000,
  GAS_PER_GATE: 2_500,
} as const;

/** Fee used by the mock deployment. Capped by MAX_FEE_BPS in the contract. */
export const MOCK_FEE_BPS = 250;

/** Mock token. Not a real token: 6 decimals like USDC, used only so amounts read naturally. */
export const MOCK_TOKEN = { symbol: 'mUSDC', decimals: 6 } as const;

export const CHAIN_ID_FOR_COMMITMENTS = 196;
/** Placeholder contract address used inside mock commitments. Not deployed anywhere. */
export const MOCK_CONTRACT = '0x0000000000000000000000000000000000007461' as const;

export function evalGasEstimate(nIn: number, maxGates: number): number {
  return 2 ** nIn * (RULES.GAS_PER_EVAL_BASE + RULES.GAS_PER_GATE * maxGates);
}
