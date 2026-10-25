import {
  GetCommand,
  QueryCommand,
  TransactWriteCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { DocClient } from '../db/client';
import { cancellationCode, isAwsError } from '../db/errors';

export interface RecordingRecord {
  id: string;
  userId: string;
  status: 'pending' | 'ready';
  s3Key: string;
  /** S3 multipart upload id, while pending. */
  uploadId: string;
  mimeType: string;
  sizeBytes: number;
  durationMs: number;
  createdAt: string;
}

export class QuotaExceededError extends Error {
  constructor() {
    super('Recording storage quota exceeded');
    this.name = 'QuotaExceededError';
  }
}

const recordingKey = (userId: string, id: string) => ({ PK: `USER#${userId}`, SK: `REC#${id}` });
/** Bytes reserved by the user's recordings (pending + ready), for the quota. */
const usageKey = (userId: string) => ({ PK: `USER#${userId}`, SK: 'USAGE' });

const encodeCursor = (key: Record<string, unknown> | undefined) =>
  key ? Buffer.from(JSON.stringify(key)).toString('base64url') : null;

function decodeCursor(userId: string, cursor: string | undefined) {
  if (!cursor) return undefined;
  try {
    const key = JSON.parse(Buffer.from(cursor, 'base64url').toString()) as Record<string, unknown>;
    // Never let a cursor point into another user's partition.
    return key.PK === `USER#${userId}` && typeof key.SK === 'string' ? key : undefined;
  } catch {
    return undefined;
  }
}

export function createRecordingsRepository(db: DocClient, tableName: string) {
  return {
    /** Creates the recording and reserves its bytes against the quota, atomically. */
    async create(recording: RecordingRecord, quotaBytes: number): Promise<void> {
      try {
        await db.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: tableName,
                  Key: usageKey(recording.userId),
                  UpdateExpression: 'ADD bytes :size',
                  ConditionExpression: 'attribute_not_exists(bytes) OR bytes <= :remaining',
                  ExpressionAttributeValues: {
                    ':size': recording.sizeBytes,
                    ':remaining': quotaBytes - recording.sizeBytes,
                  },
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: { ...recordingKey(recording.userId, recording.id), ...recording },
                  ConditionExpression: 'attribute_not_exists(PK)',
                },
              },
            ],
          }),
        );
      } catch (err) {
        if (cancellationCode(err, 0) === 'ConditionalCheckFailed') throw new QuotaExceededError();
        throw err;
      }
    },

    /** Strongly consistent: used for state transitions (complete/delete) right after create. */
    async get(userId: string, id: string): Promise<RecordingRecord | undefined> {
      const { Item } = await db.send(
        new GetCommand({
          TableName: tableName,
          Key: recordingKey(userId, id),
          ConsistentRead: true,
        }),
      );
      return Item as RecordingRecord | undefined;
    },

    /** Ready recordings, newest first (ULID ids sort by time). Eventually consistent (SPEC §5). */
    async listReady(userId: string, limit: number, cursor?: string) {
      const exclusiveStartKey = decodeCursor(userId, cursor);
      const { Items = [], LastEvaluatedKey } = await db.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: 'PK = :pk AND begins_with(SK, :rec)',
          FilterExpression: '#status = :ready',
          ExpressionAttributeNames: { '#status': 'status' },
          ExpressionAttributeValues: { ':pk': `USER#${userId}`, ':rec': 'REC#', ':ready': 'ready' },
          ScanIndexForward: false,
          Limit: limit,
          ...(exclusiveStartKey && { ExclusiveStartKey: exclusiveStartKey }),
        }),
      );
      return { items: Items as RecordingRecord[], nextCursor: encodeCursor(LastEvaluatedKey) };
    },

    /** pending → ready. Idempotent: returns false if it was already ready. */
    async markReady(userId: string, id: string): Promise<boolean> {
      try {
        await db.send(
          new UpdateCommand({
            TableName: tableName,
            Key: recordingKey(userId, id),
            UpdateExpression: 'SET #status = :ready REMOVE uploadId',
            ConditionExpression: '#status = :pending',
            ExpressionAttributeNames: { '#status': 'status' },
            ExpressionAttributeValues: { ':ready': 'ready', ':pending': 'pending' },
          }),
        );
        return true;
      } catch (err) {
        if (isAwsError(err, 'ConditionalCheckFailedException')) return false;
        throw err;
      }
    },

    /** Deletes the recording and releases its bytes from the quota, atomically. No-op if already gone. */
    async delete(recording: Pick<RecordingRecord, 'userId' | 'id' | 'sizeBytes'>): Promise<void> {
      try {
        await db.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Delete: {
                  TableName: tableName,
                  Key: recordingKey(recording.userId, recording.id),
                  ConditionExpression: 'attribute_exists(PK)',
                },
              },
              {
                Update: {
                  TableName: tableName,
                  Key: usageKey(recording.userId),
                  UpdateExpression: 'ADD bytes :negSize',
                  ExpressionAttributeValues: { ':negSize': -recording.sizeBytes },
                },
              },
            ],
          }),
        );
      } catch (err) {
        if (cancellationCode(err, 0) === 'ConditionalCheckFailed') return;
        throw err;
      }
    },

    async usageBytes(userId: string): Promise<number> {
      const { Item } = await db.send(
        new GetCommand({ TableName: tableName, Key: usageKey(userId), ConsistentRead: true }),
      );
      return (Item?.bytes as number | undefined) ?? 0;
    },
  };
}

export type RecordingsRepository = ReturnType<typeof createRecordingsRepository>;
