// Known placeholder values shipped in .env.example / the old code fallback.
// A production deploy that still carries any of these is misconfigured and
// must not be allowed to start — otherwise tokens can be forged by anyone.
const KNOWN_WEAK_SECRETS = new Set([
  'dev-secret-do-not-use',
  'change-me-to-a-long-random-string-min-64-chars',
]);

const MIN_JWT_SECRET_LENGTH = 32;

// Fail-fast guard for JWT_SECRET. Returns the validated secret so it can be
// used inline (e.g. as passport's secretOrKey); throws at boot otherwise.
export function assertStrongJwtSecret(secret: string | undefined | null): string {
  if (!secret || secret.trim().length < MIN_JWT_SECRET_LENGTH || KNOWN_WEAK_SECRETS.has(secret)) {
    throw new Error(
      `JWT_SECRET is missing, shorter than ${MIN_JWT_SECRET_LENGTH} characters, or set to a ` +
        'known placeholder. Refusing to start — set a strong random JWT_SECRET (64+ chars).',
    );
  }
  return secret;
}
