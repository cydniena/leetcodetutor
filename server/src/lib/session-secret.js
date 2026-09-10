// The `sid` cookie is signed with SESSION_SECRET, so the secret is the only
// thing standing between a visitor and a forged session id. A fallback that
// ships in the repository is therefore not a fallback at all: anyone who can
// read the source can sign a cookie for any session.
//
// So: production refuses to boot without a real secret, and development
// generates a throwaway one for the life of the process instead of reusing a
// published string. Both are noisy; neither is silent.

import { randomBytes } from 'node:crypto';

export const MIN_SECRET_LENGTH = 32;

// Strings that have been published -- .env.example, the README, this file's
// own history. A public secret is worth no more than no secret.
const PLACEHOLDERS = new Set([
  'change-me-to-a-long-random-string',
  'dev-only-insecure-secret',
  'changeme',
  'change-me',
  'secret',
  'session-secret',
  'your-secret-here',
  'password',
]);

/** Why this value is unusable, or null if it is fine. Phrased to follow "SESSION_SECRET". */
function describeProblem(secret) {
  if (!secret) return 'is not set';
  if (PLACEHOLDERS.has(secret.toLowerCase())) {
    return 'is still the placeholder from .env.example, which is public';
  }
  if (secret.length < MIN_SECRET_LENGTH) {
    return `is ${secret.length} characters long; at least ${MIN_SECRET_LENGTH} are required`;
  }
  if (new Set(secret).size < 8) {
    return 'has too little variety to be random; use crypto-random bytes';
  }
  return null;
}

const HOW_TO_GENERATE = "node -e \"console.log(require('node:crypto').randomBytes(32).toString('hex'))\"";

/**
 * Decide what to sign session cookies with.
 *
 * @returns {{ secret: string, generated: boolean, warning: string|null }}
 * @throws in production, when SESSION_SECRET is missing or too weak to trust.
 */
export function resolveSessionSecret(env = process.env) {
  const raw = env.SESSION_SECRET;
  const secret = typeof raw === 'string' ? raw.trim() : '';
  const problem = describeProblem(secret);

  if (!problem) return { secret, generated: false, warning: null };

  if (env.NODE_ENV === 'production') {
    throw new Error(
      `SESSION_SECRET ${problem}. Set it to at least ${MIN_SECRET_LENGTH} random ` +
      `characters before starting in production. Generate one with:\n  ${HOW_TO_GENERATE}`,
    );
  }

  return {
    secret: randomBytes(32).toString('hex'),
    generated: true,
    warning:
      `SESSION_SECRET ${problem}, so this process signed session cookies with a ` +
      'random secret that is discarded on restart. Every session will be dropped ' +
      `when the server reloads. Set SESSION_SECRET in .env to keep sessions:\n  ${HOW_TO_GENERATE}`,
  };
}
