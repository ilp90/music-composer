import { DeleteCommand, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DocClient } from '../db/client';

/**
 * Failed-login counter per email in fixed windows. Keyed by email (not user id) so unknown and
 * existing accounts are throttled identically. One atomic counter item per window; TTL cleans up.
 */
export function createLoginAttemptsRepository(
  db: DocClient,
  tableName: string,
  windowSeconds: number,
) {
  const window = (now: Date) => {
    const index = Math.floor(now.getTime() / 1000 / windowSeconds);
    const endsAt = (index + 1) * windowSeconds;
    return { index, endsAt };
  };
  const key = (email: string, index: number) => ({ PK: `LOGINFAIL#${email}`, SK: `W#${index}` });

  return {
    /** Failures in the current window and seconds until it resets. */
    async get(email: string, now: Date): Promise<{ failures: number; resetsInSeconds: number }> {
      const { index, endsAt } = window(now);
      const { Item } = await db.send(
        new GetCommand({ TableName: tableName, Key: key(email, index) }),
      );
      return {
        failures: (Item?.failures as number | undefined) ?? 0,
        resetsInSeconds: Math.max(1, endsAt - Math.floor(now.getTime() / 1000)),
      };
    },

    async recordFailure(email: string, now: Date): Promise<void> {
      const { index, endsAt } = window(now);
      await db.send(
        new UpdateCommand({
          TableName: tableName,
          Key: key(email, index),
          UpdateExpression: 'ADD failures :one SET expiresAt = :exp',
          ExpressionAttributeValues: { ':one': 1, ':exp': endsAt + windowSeconds },
        }),
      );
    },

    async clear(email: string, now: Date): Promise<void> {
      await db.send(
        new DeleteCommand({ TableName: tableName, Key: key(email, window(now).index) }),
      );
    },
  };
}

export type LoginAttemptsRepository = ReturnType<typeof createLoginAttemptsRepository>;
