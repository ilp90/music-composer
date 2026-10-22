import {
  CreateTableCommand,
  UpdateTimeToLiveCommand,
  type DynamoDBClient,
} from '@aws-sdk/client-dynamodb';
import { isAwsError } from './errors';

/** Single-table design (SPEC §3). Items expire via TTL on `expiresAt` (epoch seconds). */
export async function ensureTable(client: DynamoDBClient, tableName: string): Promise<boolean> {
  try {
    await client.send(
      new CreateTableCommand({
        TableName: tableName,
        BillingMode: 'PAY_PER_REQUEST',
        AttributeDefinitions: [
          { AttributeName: 'PK', AttributeType: 'S' },
          { AttributeName: 'SK', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'PK', KeyType: 'HASH' },
          { AttributeName: 'SK', KeyType: 'RANGE' },
        ],
      }),
    );
  } catch (err) {
    if (isAwsError(err, 'ResourceInUseException')) return false;
    throw err;
  }
  await client.send(
    new UpdateTimeToLiveCommand({
      TableName: tableName,
      TimeToLiveSpecification: { AttributeName: 'expiresAt', Enabled: true },
    }),
  );
  return true;
}

/** DynamoDB TTL attributes are epoch seconds. */
export function epochSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}
