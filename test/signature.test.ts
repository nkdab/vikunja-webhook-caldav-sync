import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyVikunjaSignature } from '../src/utils/signature';

describe('verifyVikunjaSignature', () => {
  it('verifies signature with sha256= prefix', () => {
    const body = Buffer.from('{"hello":"world"}', 'utf-8');
    const secret = 'top-secret';
    const sig = createHmac('sha256', secret).update(body).digest('hex');

    expect(verifyVikunjaSignature(body, `sha256=${sig}`, secret)).toBe(true);
  });

  it('returns false for invalid signatures', () => {
    const body = Buffer.from('{"hello":"world"}', 'utf-8');
    const secret = 'top-secret';
    expect(verifyVikunjaSignature(body, 'deadbeef', secret)).toBe(false);
  });
});
