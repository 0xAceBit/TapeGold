import { BaseError, ContractFunctionRevertedError } from 'viem';
import { friendlyError } from './wallet';

const TEXT: Record<string, (a: readonly unknown[]) => string> = {
  CommitPhaseClosed: () => 'The commit phase is over.',
  AlreadyCommitted: () => 'This wallet already committed to this challenge. You cannot commit twice.',
  NotRevealPhase: () => 'Reveals are only open between the commit deadline and the reveal deadline.',
  NoCommit: () => 'This wallet has no commit in this challenge.',
  AlreadyRevealed: () => 'You already revealed in this challenge.',
  CommitMismatch: () => 'The circuit id and salt do not match your commit.',
  NotCircuitOwner: (a) => `This wallet does not own that circuit (owner: ${String(a[0])}).`,
  CircuitAlreadyUsed: () => 'That circuit was already used in this challenge.',
  InputCountMismatch: () => 'That circuit has the wrong number of inputs for this challenge.',
  OutputCountMismatch: () => 'That circuit has the wrong number of outputs for this challenge.',
  StatefulCircuit: () => 'Circuits with latches are not accepted.',
  CircuitTooExpensive: () => 'That circuit is too large to grade within the gas budget.',
  TruthTableMismatch: (a) => `That circuit gives the wrong answer for input ${String(a[0])}.`,
  ChallengeNotEnded: () => 'The reveal phase is not over yet.',
  AlreadyFinalized: () => 'This challenge is already finalized.',
  NothingToWithdraw: () => 'Nothing to withdraw.',
  NothingToRefund: () => 'Nothing to refund.',
  RefundNotAvailable: () => 'No refund is available for this challenge.',
  ChallengeNotFound: () => 'That challenge does not exist.',
};

/** Turns a viem / wallet error into one plain sentence. */
export function explain(e: unknown): string {
  if (e instanceof BaseError) {
    const revert = e.walk((x) => x instanceof ContractFunctionRevertedError);
    if (revert instanceof ContractFunctionRevertedError && revert.data) {
      const f = TEXT[revert.data.errorName];
      return f ? f(revert.data.args ?? []) : `The contract rejected this: ${revert.data.errorName}.`;
    }
    const short = (e as { shortMessage?: string }).shortMessage;
    const inner = e.walk();
    if (/user rejected|denied|rejected/i.test(e.message)) return 'You rejected the request in your wallet.';
    return friendlyError(inner) === inner.message ? (short ?? inner.message) : friendlyError(inner);
  }
  return friendlyError(e);
}
