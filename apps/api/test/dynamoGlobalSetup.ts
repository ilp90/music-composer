import { DeleteTableCommand } from '@aws-sdk/client-dynamodb';
import type { TestProject } from 'vitest/node';
import { createDynamoClient } from '../src/db/client';
import { ensureTable } from '../src/db/schema';

declare module 'vitest' {
  export interface ProvidedContext {
    dynamoEndpoint: string;
    dynamoTable: string;
  }
}

export default async function setup(project: TestProject) {
  const endpoint = process.env.DYNAMODB_ENDPOINT ?? 'http://localhost:8000';
  const table = `app-test-${Date.now()}`;
  // DynamoDB Local accepts any credentials; RustFS (S3) needs its root user from docker-compose.yml.
  process.env.AWS_ACCESS_KEY_ID ??= 'localdev';
  process.env.AWS_SECRET_ACCESS_KEY ??= 'localdev-secret';

  const client = createDynamoClient({ AWS_REGION: 'us-east-1', DYNAMODB_ENDPOINT: endpoint });
  try {
    await ensureTable(client, table);
  } catch (err) {
    throw new Error(
      `Integration tests need DynamoDB Local at ${endpoint}. Run \`docker compose up -d\`.`,
      {
        cause: err,
      },
    );
  }

  project.provide('dynamoEndpoint', endpoint);
  project.provide('dynamoTable', table);

  return async () => {
    await client.send(new DeleteTableCommand({ TableName: table }));
    client.destroy();
  };
}
