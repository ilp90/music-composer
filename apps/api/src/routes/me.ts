import type { User } from '@mc/shared';
import type { FastifyPluginAsync } from 'fastify';
import { AppError } from '../errors';
import { requireAuth } from '../plugins/authGuard';
import type { UsersRepository } from '../repositories/users';
import type { TokenService } from '../services/tokens';
import { toPublicUser } from '../services/sessions';

export interface MeRoutesOptions {
  users: UsersRepository;
  tokens: TokenService;
}

export const meRoutes: FastifyPluginAsync<MeRoutesOptions> = async (app, { users, tokens }) => {
  app.get('/me', { preHandler: requireAuth(tokens) }, async (request): Promise<User> => {
    const user = await users.findById(request.userId);
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Account not found');
    return toPublicUser(user);
  });
};
