import crypto from "node:crypto";

const DEFAULT_ITERATIONS = 100_000;
const KEY_LENGTH = 32;
const DIGEST = "sha512";
const DEFAULT_SALT_LENGTH = 32;
const API_KEY_PREFIX = "ci_live_";

export function deriveKey(
  password: string,
  salt: string,
  iterations: number = DEFAULT_ITERATIONS,
): Promise<string> {
  return new Promise((resolve, reject) => {
    crypto.pbkdf2(password, salt, iterations, KEY_LENGTH, DIGEST, (err, derivedKey) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(derivedKey.toString("hex"));
    });
  });
}

export function generateSalt(length: number = DEFAULT_SALT_LENGTH): string {
  return crypto.randomBytes(length).toString("hex");
}

export function generateApiKey(): { key: string; prefix: string } {
  const randomHex = crypto.randomBytes(16).toString("hex");
  const key = `${API_KEY_PREFIX}${randomHex}`;
  const prefix = key.slice(0, 8);

  return { key, prefix };
}
