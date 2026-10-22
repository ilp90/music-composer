import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.test.ts'],
          exclude: ['src/**/*.int.test.ts'],
        },
      },
      {
        // Needs DynamoDB Local (`docker compose up -d`). Each run gets its own throwaway table.
        extends: true,
        test: {
          name: 'integration',
          include: ['src/**/*.int.test.ts'],
          globalSetup: ['./test/dynamoGlobalSetup.ts'],
          testTimeout: 15_000,
        },
      },
    ],
  },
});
