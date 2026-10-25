import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutBucketCorsCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config } from '../config';
import { isAwsError } from '../db/errors';

export function createS3Client(config: Pick<Config, 'AWS_REGION' | 'S3_ENDPOINT'>) {
  return new S3Client({
    region: config.AWS_REGION,
    ...(config.S3_ENDPOINT && { endpoint: config.S3_ENDPOINT, forcePathStyle: true }),
    // The SDK's default flexible checksums bake a checksum of an *empty* body into presigned
    // UploadPart URLs, so every browser upload would fail with BadDigest. Only send them when required.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    maxAttempts: 3,
    requestHandler: { connectionTimeout: 1_000, requestTimeout: 10_000 },
  });
}

/** Recording objects in S3. Video bytes only ever move between the browser and S3 via presigned URLs. */
export function createStorage(s3: S3Client, bucket: string) {
  return {
    async createMultipartUpload(key: string, contentType: string): Promise<string> {
      const { UploadId } = await s3.send(
        new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }),
      );
      if (!UploadId) throw new Error('S3 returned no UploadId');
      return UploadId;
    },

    presignParts(key: string, uploadId: string, partCount: number, expiresIn: number) {
      return Promise.all(
        Array.from({ length: partCount }, async (_, i) => ({
          partNumber: i + 1,
          url: await getSignedUrl(
            s3,
            new UploadPartCommand({
              Bucket: bucket,
              Key: key,
              UploadId: uploadId,
              PartNumber: i + 1,
            }),
            { expiresIn },
          ),
        })),
      );
    },

    /** Returns false when S3 has no such upload (already completed or aborted). */
    async completeMultipartUpload(
      key: string,
      uploadId: string,
      parts: ReadonlyArray<{ partNumber: number; etag: string }>,
    ): Promise<boolean> {
      try {
        await s3.send(
          new CompleteMultipartUploadCommand({
            Bucket: bucket,
            Key: key,
            UploadId: uploadId,
            MultipartUpload: {
              Parts: [...parts]
                .sort((a, b) => a.partNumber - b.partNumber)
                .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
            },
          }),
        );
        return true;
      } catch (err) {
        if (isAwsError(err, 'NoSuchUpload')) return false;
        throw err;
      }
    },

    async abortMultipartUpload(key: string, uploadId: string): Promise<void> {
      try {
        await s3.send(
          new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }),
        );
      } catch (err) {
        if (!isAwsError(err, 'NoSuchUpload')) throw err;
      }
    },

    /** Object size in bytes, or undefined if it doesn't exist. */
    async size(key: string): Promise<number | undefined> {
      try {
        const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
        return head.ContentLength;
      } catch (err) {
        if (isAwsError(err, 'NotFound') || isAwsError(err, 'NoSuchKey')) return undefined;
        throw err;
      }
    },

    presignGet(key: string, expiresIn: number, downloadFilename?: string): Promise<string> {
      return getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket,
          Key: key,
          ...(downloadFilename && {
            ResponseContentDisposition: `attachment; filename="${downloadFilename}"`,
          }),
        }),
        { expiresIn },
      );
    },

    async delete(key: string): Promise<void> {
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },

    /** Local dev only: let the web app PUT parts and read ETags cross-origin. In AWS this is set by CDK. */
    async allowBrowserUploads(origin: string): Promise<void> {
      await s3.send(
        new PutBucketCorsCommand({
          Bucket: bucket,
          CORSConfiguration: {
            CORSRules: [
              {
                AllowedOrigins: [origin],
                AllowedMethods: ['PUT', 'GET', 'HEAD'],
                AllowedHeaders: ['*'],
                ExposeHeaders: ['ETag'],
                MaxAgeSeconds: 3600,
              },
            ],
          },
        }),
      );
    },
  };
}

export type Storage = ReturnType<typeof createStorage>;
