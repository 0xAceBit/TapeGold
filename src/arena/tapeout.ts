import { parseAbi } from 'viem';

/** The three TapeOut circuits calls Arena itself makes (SPIKE.md C6, C9, C11, C16). Used here for read-only pre-flight checks. */
export const circuitsAbi = parseAbi([
  'function eval(uint256 id, bytes inputs) view returns (bytes)',
  'function circuitInfo(uint256 id) view returns (uint32 nIn, uint32 nOut, uint32 nState, uint32 gateCount)',
  'function ownerOf(uint256 id) view returns (address)',
]);

export const erc20Abi = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
]);
