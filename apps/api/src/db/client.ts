import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import type { Config } from '../config';

/** Short timeouts + SDK retries (exponential backoff with jitter) so a slow dependency fails fast (SPEC §5). */
export function createDynamoClient(config: Pick<Config, 'AWS_REGION' | 'DYNAMODB_ENDPOINT'>) {
  return new DynamoDBClient({
    region: config.AWS_REGION,
    ...(config.DYNAMODB_ENDPOINT && { endpoint: config.DYNAMODB_ENDPOINT }),
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 1_000, requestTimeout: 3_000 },
  });
}

export function createDocClient(client: DynamoDBClient) {
  return DynamoDBDocumentClient.from(client, {
    marshallOptions: { removeUndefinedValues: true },
  });
}

export type DocClient = ReturnType<typeof createDocClient>;
