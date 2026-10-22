// Creates the DynamoDB table and S3 bucket in the local docker-compose services. Safe to re-run.
import {
  BucketAlreadyOwnedByYou,
  CreateBucketCommand,
  HeadBucketCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { loadConfig } from '../src/config';
import { createDynamoClient } from '../src/db/client';
import { ensureTable } from '../src/db/schema';

const config = loadConfig();

if (!config.DYNAMODB_ENDPOINT || !config.S3_ENDPOINT) {
  throw new Error(
    'local:init only targets local services; set DYNAMODB_ENDPOINT and S3_ENDPOINT (see .env.example).',
  );
}

const created = await ensureTable(createDynamoClient(config), config.DYNAMODB_TABLE);
console.log(
  `DynamoDB: ${created ? 'created table' : 'table'} "${config.DYNAMODB_TABLE}"${created ? '' : ' already exists'}`,
);

const s3 = new S3Client({
  region: config.AWS_REGION,
  endpoint: config.S3_ENDPOINT,
  forcePathStyle: true,
});

try {
  await s3.send(new HeadBucketCommand({ Bucket: config.S3_BUCKET }));
  console.log(`S3: bucket "${config.S3_BUCKET}" already exists`);
} catch {
  try {
    await s3.send(new CreateBucketCommand({ Bucket: config.S3_BUCKET }));
    console.log(`S3: created bucket "${config.S3_BUCKET}"`);
  } catch (err) {
    if (!(err instanceof BucketAlreadyOwnedByYou)) throw err;
  }
}
