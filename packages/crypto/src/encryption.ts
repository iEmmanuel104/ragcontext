import crypto from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;

export interface EncryptedData {
  iv: string;
  ciphertext: string;
  tag: string;
  keyId: string;
}

function validateKey(key: string): Buffer {
  const keyBuffer = Buffer.from(key, "utf-8");
  if (keyBuffer.length !== KEY_LENGTH) {
    throw new Error(`Key must be exactly ${KEY_LENGTH} bytes, got ${keyBuffer.length}`);
  }
  return keyBuffer;
}

function deriveKeyId(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export function encrypt(plaintext: string, key: string): EncryptedData {
  const keyBuffer = validateKey(key);
  const iv = crypto.randomBytes(IV_LENGTH);

  const cipher = crypto.createCipheriv(ALGORITHM, keyBuffer, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return {
    iv: iv.toString("hex"),
    ciphertext: encrypted.toString("hex"),
    tag: tag.toString("hex"),
    keyId: deriveKeyId(key),
  };
}

export function decrypt(data: EncryptedData, key: string): string {
  const keyBuffer = validateKey(key);
  const iv = Buffer.from(data.iv, "hex");
  const ciphertext = Buffer.from(data.ciphertext, "hex");
  const tag = Buffer.from(data.tag, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, keyBuffer, iv);
  decipher.setAuthTag(tag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString("utf-8");
}
