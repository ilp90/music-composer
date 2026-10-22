import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { DocClient } from '../db/client';
import { cancellationCode } from '../db/errors';

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  /** Absent for accounts created through Google sign-in. */
  passwordHash?: string;
  createdAt: string;
}

export class EmailTakenError extends Error {
  constructor() {
    super('Email already registered');
    this.name = 'EmailTakenError';
  }
}

const userKey = (id: string) => ({ PK: `USER#${id}`, SK: 'PROFILE' });
const emailKey = (email: string) => ({ PK: `EMAIL#${email}`, SK: 'EMAIL' });

export function createUsersRepository(db: DocClient, tableName: string) {
  // Eventually consistent reads (SPEC §5): a profile written a moment ago may briefly read as missing.
  const findById = async (id: string): Promise<UserRecord | undefined> => {
    const { Item } = await db.send(new GetCommand({ TableName: tableName, Key: userKey(id) }));
    return Item && toUserRecord(Item);
  };

  return {
    /** Writes the profile and the EMAIL# uniqueness guard atomically; a taken email fails the whole write. */
    async create(user: UserRecord): Promise<void> {
      try {
        await db.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Put: {
                  TableName: tableName,
                  Item: { ...userKey(user.id), ...user },
                  ConditionExpression: 'attribute_not_exists(PK)',
                },
              },
              {
                Put: {
                  TableName: tableName,
                  Item: { ...emailKey(user.email), userId: user.id },
                  ConditionExpression: 'attribute_not_exists(PK)',
                },
              },
            ],
          }),
        );
      } catch (err) {
        if (cancellationCode(err, 1) === 'ConditionalCheckFailed') {
          throw new EmailTakenError();
        }
        throw err;
      }
    },

    findById,

    async findByEmail(email: string): Promise<UserRecord | undefined> {
      const { Item } = await db.send(
        new GetCommand({ TableName: tableName, Key: emailKey(email) }),
      );
      return Item ? findById(Item.userId as string) : undefined;
    },
  };
}

function toUserRecord(item: Record<string, unknown>): UserRecord {
  const { id, email, displayName, passwordHash, createdAt } = item as unknown as UserRecord;
  return {
    id,
    email,
    displayName,
    createdAt,
    ...(passwordHash !== undefined && { passwordHash }),
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
