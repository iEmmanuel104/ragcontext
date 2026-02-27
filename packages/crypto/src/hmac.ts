import crypto from "node:crypto";

const HMAC_ALGORITHM = "sha256";

export function generateHmac(data: string, secret: string): string {
  return crypto.createHmac(HMAC_ALGORITHM, secret).update(data).digest("hex");
}

export function verifyHmac(data: string, secret: string, hmac: string): boolean {
  const computed = generateHmac(data, secret);

  const computedBuffer = Buffer.from(computed, "hex");
  const providedBuffer = Buffer.from(hmac, "hex");

  if (computedBuffer.length !== providedBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(computedBuffer, providedBuffer);
}
