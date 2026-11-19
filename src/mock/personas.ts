import type { Address } from 'viem';
import type { Persona, PersonaId } from './types';

const demoAddress = (n: number): Address => `0x${n.toString(16).padStart(40, '0')}`;

/** Made-up demo identities. None of these are real wallets and none can sign anything. */
export const PERSONAS: Persona[] = [
  { id: 'ana', name: 'Ana', role: 'Sponsor', address: demoAddress(0xa11ce) },
  { id: 'bo', name: 'Bo', role: 'Designer', address: demoAddress(0xb0b) },
  { id: 'cy', name: 'Cy', role: 'Designer', address: demoAddress(0xc1c1) },
  { id: 'di', name: 'Di', role: 'Designer', address: demoAddress(0xd1d1) },
];

/** Mock fee recipient. In the contract this is an immutable constructor argument. */
export const FEE_RECIPIENT: Persona = {
  id: 'ana',
  name: 'Protocol fee',
  role: 'Fee recipient',
  address: demoAddress(0xfee),
};

export const PERSONA_BY_ID = Object.fromEntries(PERSONAS.map((p) => [p.id, p])) as Record<PersonaId, Persona>;

export function personaName(address: string): string {
  const found = PERSONAS.find((p) => p.address === address);
  if (found) return found.name;
  if (address === FEE_RECIPIENT.address) return FEE_RECIPIENT.name;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
