import { parseAbi } from 'viem';

/** The three TapeOut circuits calls Arena itself makes (SPIKE.md C6, C9, C11, C16). Used here for read-only pre-flight checks. */
export const circuitsAbi = parseAbi([
  'function eval(uint256 id, bytes inputs) view returns (bytes)',
  'function circuitInfo(uint256 id) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)',
  'function ownerOf(uint256 id) view returns (address)',
  'function netlist(uint256 id) view returns (bytes)',
]);

export const erc20Abi = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
]);

/** The TapeOut factory's registry check, the same call Arena makes when a challenge is created (SPIKE.md C1). */
export const registryAbi = parseAbi(['function isCPU(address circuits) view returns (bool)']);
