import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { DocClient } from '../db/client';
import { cancellationCode, isAwsError } from '../db/errors';
import { epochSeconds } from '../db/schema';

/**
 * Refresh tokens are stored only as SHA-256 hashes. Every login starts a *family* (one per device/session);
 * each refresh marks the presented token used and issues the next token in the same family.
 * Presenting an already-used token after the grace window means it was stolen: the whole family is revoked.
 */
const familyKey = (userId: string, familyId: string) => ({
  PK: `USER#${userId}`,
  SK: `RTF#${familyId}`,
});
const tokenKey = (userId: string, tokenHash: string) => ({
  PK: `USER#${userId}`,
  SK: `RT#${tokenHash}`,
});

export type RotateResult =
  | { ok: true; familyId: string }
  /** Unknown, expired or revoked token. */
  | { ok: false; reason: 'invalid' }
  /** Used again within the grace window or concurrently: reject, but leave the family alive. */
  | { ok: false; reason: 'race' }
  /** Used again after the grace window: the family has been revoked. */
  | { ok: false; reason: 'reused' };

interface RotateInput {
  userId: string;
  oldHash: string;
  newHash: string;
  now: Date;
  expiresAt: Date;
  graceSeconds: number;
}

export function createRefreshTokensRepository(db: DocClient, tableName: string) {
  const putToken = (
    userId: string,
    tokenHash: string,
    familyId: string,
    now: Date,
    expiresAt: Date,
  ) => ({
    Put: {
      TableName: tableName,
      Item: {
        ...tokenKey(userId, tokenHash),
        familyId,
        createdAt: now.toISOString(),
        expiresAt: epochSeconds(expiresAt),
      },
    },
  });

  const repo = {
    async createFamily(
      userId: string,
      familyId: string,
      tokenHash: string,
      now: Date,
      expiresAt: Date,
    ) {
      await db.send(
        new TransactWriteCommand({
          TransactItems: [
            {
              Put: {
                TableName: tableName,
                Item: {
                  ...familyKey(userId, familyId),
                  createdAt: now.toISOString(),
                  expiresAt: epochSeconds(expiresAt),
                },
              },
            },
            putToken(userId, tokenHash, familyId, now, expiresAt),
          ],
        }),
      );
    },

    async findToken(userId: string, tokenHash: string) {
      // Strongly consistent: rotation correctness depends on seeing the latest usedAt (SPEC §5).
      const { Item } = await db.send(
        new GetCommand({
          TableName: tableName,
          Key: tokenKey(userId, tokenHash),
          ConsistentRead: true,
        }),
      );
      return Item as { familyId: string; expiresAt: number; usedAt?: number } | undefined;
    },

    async rotate({
      userId,
      oldHash,
      newHash,
      now,
      expiresAt,
      graceSeconds,
    }: RotateInput): Promise<RotateResult> {
      const nowSeconds = epochSeconds(now);
      const token = await repo.findToken(userId, oldHash);
      if (!token || token.expiresAt <= nowSeconds) return { ok: false, reason: 'invalid' };

      if (token.usedAt !== undefined) {
        if (nowSeconds - token.usedAt <= graceSeconds) return { ok: false, reason: 'race' };
        await repo.revokeFamily(userId, token.familyId, now);
        return { ok: false, reason: 'reused' };
      }

      try {
        await db.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: tableName,
                  Key: tokenKey(userId, oldHash),
                  UpdateExpression: 'SET usedAt = :now',
                  ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(usedAt)',
                  ExpressionAttributeValues: { ':now': nowSeconds },
                },
              },
              {
                // Sliding session: each rotation extends the family's lifetime. Fails if the family was revoked.
                Update: {
                  TableName: tableName,
                  Key: familyKey(userId, token.familyId),
                  UpdateExpression: 'SET lastUsedAt = :iso, expiresAt = :exp',
                  ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(revokedAt)',
                  ExpressionAttributeValues: {
                    ':iso': now.toISOString(),
                    ':exp': epochSeconds(expiresAt),
                  },
                },
              },
              putToken(userId, newHash, token.familyId, now, expiresAt),
            ],
          }),
        );
      } catch (err) {
        if (cancellationCode(err, 0) === 'ConditionalCheckFailed')
          return { ok: false, reason: 'race' };
        if (cancellationCode(err, 1) === 'ConditionalCheckFailed')
          return { ok: false, reason: 'invalid' };
        throw err;
      }
      return { ok: true, familyId: token.familyId };
    },

    async revokeFamily(userId: string, familyId: string, now: Date): Promise<void> {
      try {
        await db.send(
          new UpdateCommand({
            TableName: tableName,
            Key: familyKey(userId, familyId),
            UpdateExpression: 'SET revokedAt = if_not_exists(revokedAt, :now)',
            ConditionExpression: 'attribute_exists(PK)',
            ExpressionAttributeValues: { ':now': now.toISOString() },
          }),
        );
      } catch (err) {
        // Family already expired via TTL: nothing left to revoke.
        if (!isAwsError(err, 'ConditionalCheckFailedException')) throw err;
      }
    },
  };
  return repo;
}

export type RefreshTokensRepository = ReturnType<typeof createRefreshTokensRepository>;
