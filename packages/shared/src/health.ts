import { z } from 'zod';

/** `GET /healthz` — liveness only. Must not depend on DynamoDB/S3 so the ALB never drains healthy tasks during a dependency blip. */
export const HealthResponse = z.object({
  status: z.literal('ok'),
  uptimeSeconds: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponse>;
