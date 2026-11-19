// Regenerates src/arena/abi.ts from the compiled contract. Run `forge build` first.
import { readFileSync, writeFileSync } from 'node:fs';

interface Item { type: string }
const artifact = JSON.parse(readFileSync('contracts/out/Arena.sol/Arena.json', 'utf8')) as { abi: Item[] };
const keep = artifact.abi.filter((i) => ['function', 'event', 'error'].includes(i.type));
const body = `// GENERATED from contracts/out/Arena.sol/Arena.json by \`bun run arena:abi\`. Do not edit by hand.\n// Source of truth: contracts/Arena.sol.\nexport const arenaAbi = ${JSON.stringify(keep, null, 2)} as const;\n`;
writeFileSync('src/arena/abi.ts', body);
console.log(`Wrote src/arena/abi.ts (${keep.length} items).`);
