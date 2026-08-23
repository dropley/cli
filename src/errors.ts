export class UsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UsageError';
  }
}

/** Environmental failure (e.g. a required credential is missing). Exit 1. */
export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthError';
  }
}

export const EXIT = {
  ok: 0,
  failure: 1,
  usage: 2,
} as const;
