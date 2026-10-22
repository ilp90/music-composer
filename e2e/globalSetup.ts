import { execSync } from 'node:child_process';

/** The API needs DynamoDB Local + RustFS with the table and bucket created. Idempotent and fast when already up. */
export default function globalSetup() {
  execSync('docker compose up -d --wait', { stdio: 'inherit' });
  execSync('pnpm --filter @mc/api local:init', { stdio: 'inherit' });
}
