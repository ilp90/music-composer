import { GetCommand, TransactWriteCommand } from '@aws-sdk/lib-dynamodb';
import type { DocClient } from '../db/client';
import { cancellationCode } from '../db/errors';

export interface UserRecord {
  id: string;
  email: string;
  displayName: string;
  /** Absent for accounts created through Google sign-in. */
  passwordHash?: string;
  /** Google account `sub`, once the user has signed in with Google. */
  googleSub?: string;
  createdAt: string;
}

export class EmailTakenError extends Error {
  constructor() {
    super('Email already registered');
    this.name = 'EmailTakenError';
  }
}

/** The Google account is already linked to a user, or the user is already linked to another Google account. */
export class GoogleLinkConflictError extends Error {
  constructor() {
    super('Google account link conflict');
    this.name = 'GoogleLinkConflictError';
  }
}

const userKey = (id: string) => ({ PK: `USER#${id}`, SK: 'PROFILE' });
const emailKey = (email: string) => ({ PK: `EMAIL#${email}`, SK: 'EMAIL' });
const googleKey = (sub: string) => ({ PK: `GOOGLE#${sub}`, SK: 'GOOGLE' });

export function createUsersRepository(db: DocClient, tableName: string) {
  // Eventually consistent reads (SPEC §5): a profile written a moment ago may briefly read as missing.
  const findById = async (id: string): Promise<UserRecord | undefined> => {
    const { Item } = await db.send(new GetCommand({ TableName: tableName, Key: userKey(id) }));
    return Item && toUserRecord(Item);
  };

  /** Follows a uniqueness-guard item (EMAIL# / GOOGLE#) to the user it points at. */
  const findVia = async (key: Record<string, string>): Promise<UserRecord | undefined> => {
    const { Item } = await db.send(new GetCommand({ TableName: tableName, Key: key }));
    return Item ? findById(Item.userId as string) : undefined;
  };

  const putIfAbsent = (item: Record<string, unknown>) => ({
    Put: { TableName: tableName, Item: item, ConditionExpression: 'attribute_not_exists(PK)' },
  });

  return {
    /**
     * Writes the profile with its EMAIL# guard (and GOOGLE# guard for Google sign-ups) atomically,
     * so a taken email or Google account fails the whole write.
     */
    async create(user: UserRecord): Promise<void> {
      try {
        await db.send(
          new TransactWriteCommand({
            TransactItems: [
              putIfAbsent({ ...userKey(user.id), ...user }),
              putIfAbsent({ ...emailKey(user.email), userId: user.id }),
              ...(user.googleSub
                ? [putIfAbsent({ ...googleKey(user.googleSub), userId: user.id })]
                : []),
            ],
          }),
        );
      } catch (err) {
        if (cancellationCode(err, 1) === 'ConditionalCheckFailed') throw new EmailTakenError();
        if (cancellationCode(err, 2) === 'ConditionalCheckFailed')
          throw new GoogleLinkConflictError();
        throw err;
      }
    },

    findById,

    findByEmail(email: string): Promise<UserRecord | undefined> {
      return findVia(emailKey(email));
    },

    findByGoogleSub(sub: string): Promise<UserRecord | undefined> {
      return findVia(googleKey(sub));
    },

    /** Links a Google account to an existing user. Never replaces a different linked Google account. */
    async linkGoogle(userId: string, googleSub: string): Promise<void> {
      try {
        await db.send(
          new TransactWriteCommand({
            TransactItems: [
              {
                Update: {
                  TableName: tableName,
                  Key: userKey(userId),
                  UpdateExpression: 'SET googleSub = :sub',
                  ConditionExpression: 'attribute_exists(PK) AND attribute_not_exists(googleSub)',
                  ExpressionAttributeValues: { ':sub': googleSub },
                },
              },
              putIfAbsent({ ...googleKey(googleSub), userId }),
            ],
          }),
        );
      } catch (err) {
        if (
          cancellationCode(err, 0) === 'ConditionalCheckFailed' ||
          cancellationCode(err, 1) === 'ConditionalCheckFailed'
        ) {
          throw new GoogleLinkConflictError();
        }
        throw err;
      }
    },
  };
}

function toUserRecord(item: Record<string, unknown>): UserRecord {
  const { id, email, displayName, passwordHash, googleSub, createdAt } =
    item as unknown as UserRecord;
  return {
    id,
    email,
    displayName,
    createdAt,
    ...(passwordHash !== undefined && { passwordHash }),
    ...(googleSub !== undefined && { googleSub }),
  };
}

export type UsersRepository = ReturnType<typeof createUsersRepository>;
