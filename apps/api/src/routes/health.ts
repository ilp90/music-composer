import type { HealthResponse } from '@mc/shared';
import type { FastifyPluginAsync } from 'fastify';

export const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/healthz', async (): Promise<HealthResponse> => {
    return { status: 'ok', uptimeSeconds: process.uptime() };
  });
};
