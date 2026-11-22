import argon2 from 'argon2';

// argon2id with OWASP-recommended-or-stronger parameters (64 MiB, 3 passes).
const OPTIONS = { type: argon2.argon2id, memoryCost: 2 ** 16, timeCost: 3, parallelism: 1 };

export const hashPassword = (plain) => argon2.hash(plain, OPTIONS);

export async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// Verified against when the email is unknown or the account is locked, so response
// time does not reveal whether an account exists.
let dummyHashPromise;
export function verifyAgainstDummy(plain) {
  dummyHashPromise ??= argon2.hash('meetspace-dummy-password', OPTIONS);
  return dummyHashPromise.then((h) => verifyPassword(h, plain));
}
