import { createHmac, timingSafeEqual } from 'node:crypto';

export function verifyVikunjaSignature(
  rawBody: Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  const normalizedHeader = signatureHeader.startsWith('sha256=')
    ? signatureHeader.slice('sha256='.length)
    : signatureHeader;

  const expectedHex = createHmac('sha256', secret).update(rawBody).digest('hex');
  const expected = Buffer.from(expectedHex, 'hex');
  let provided: Buffer;

  try {
    provided = Buffer.from(normalizedHeader, 'hex');
  } catch {
    return false;
  }

  if (expected.length !== provided.length) {
    return false;
  }

  return timingSafeEqual(expected, provided);
}
