// Prints a JWT_PRIVATE_JWK line for apps/api/.env (or for AWS Secrets Manager in production).
import { randomUUID } from 'node:crypto';
import { exportJWK, generateKeyPair } from 'jose';

const { privateKey } = await generateKeyPair('ES256', { extractable: true });
const jwk = { ...(await exportJWK(privateKey)), kid: randomUUID(), alg: 'ES256' };

console.log(`JWT_PRIVATE_JWK='${JSON.stringify(jwk)}'`);
