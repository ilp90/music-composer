import type { TransactionCanceledException } from '@aws-sdk/client-dynamodb';

// AWS errors are matched by name, not instanceof: lib-dynamodb may load its own copy of the SDK classes.

export function isAwsError(err: unknown, name: string): boolean {
  return err instanceof Error && err.name === name;
}

/** Reason code for one item (by index) of a cancelled TransactWrite. */
export function cancellationCode(err: unknown, index: number): string | undefined {
  if (!isAwsError(err, 'TransactionCanceledException')) return undefined;
  return (err as TransactionCanceledException).CancellationReasons?.[index]?.Code;
}
