import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

vi.mock('../lib/prisma', () => ({
  prisma: {
    webAuthnCredential: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from '../lib/prisma';
import { webauthnService } from './webauthnService';

type MockFn = ReturnType<typeof vi.fn>;

/** Build a signed assertion using a real EC P-256 key so the crypto path is exercised end-to-end. */
function buildAssertion(privateKey: crypto.KeyObject, challengeB64Url: string) {
  // authenticatorData: 37 bytes minimum (32 rpIdHash + 1 flags + 4 counter).
  const authData = Buffer.alloc(37);
  authData.writeUInt32BE(5, 33); // signCount = 5
  const clientDataJSON = Buffer.from(
    JSON.stringify({ type: 'webauthn.get', challenge: challengeB64Url, origin: 'https://app.example.com' }),
  );
  const clientDataHash = crypto.createHash('sha256').update(clientDataJSON).digest();
  const signedData = Buffer.concat([authData, clientDataHash]);
  const signature = crypto.sign('sha256', signedData, privateKey);
  return {
    authenticatorData: authData.toString('base64'),
    clientDataJSON: clientDataJSON.toString('base64'),
    signature: signature.toString('base64'),
  };
}

describe('webauthnService.verifyAuthentication signature enforcement', () => {
  let publicKeyDer: Buffer;
  let privateKey: crypto.KeyObject;

  beforeEach(() => {
    vi.clearAllMocks();
    const { publicKey, privateKey: priv } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
    privateKey = priv;
    publicKeyDer = publicKey.export({ format: 'der', type: 'spki' }) as Buffer;

    (prisma.user.update as MockFn).mockResolvedValue({});
    (prisma.webAuthnCredential.update as MockFn).mockResolvedValue({});
    (prisma.webAuthnCredential.findMany as MockFn).mockResolvedValue([]);
    (prisma.webAuthnCredential.findUnique as MockFn).mockResolvedValue({
      id: 'cred-row-1',
      credentialId: 'cred-1',
      userId: 'user-1',
      publicKey: publicKeyDer,
      counter: 0,
      user: {
        id: 'user-1',
        fullName: 'Test User',
        email: 't@example.com',
        role: 'TEACHER',
        schoolId: 'school-1',
        departmentId: null,
        classId: null,
        isLocked: false,
      },
    });
  });

  async function seedChallenge(): Promise<string> {
    const opts = await webauthnService.generateAuthenticationOptions('user-1');
    // The service stores the challenge and later compares base64url(stored) to clientData.challenge.
    return opts.challenge.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  }

  it('accepts a genuine signature from the registered key', async () => {
    const challengeB64Url = await seedChallenge();
    const assertion = buildAssertion(privateKey, challengeB64Url);

    const result = await webauthnService.verifyAuthentication(
      'cred-1',
      assertion.authenticatorData,
      assertion.clientDataJSON,
      assertion.signature,
    );

    expect(result.userId).toBe('user-1');
    expect(prisma.webAuthnCredential.update).toHaveBeenCalled();
  });

  it('rejects a forged assertion signed by a different key (auth-bypass guard)', async () => {
    const challengeB64Url = await seedChallenge();
    const attacker = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey;
    const assertion = buildAssertion(attacker, challengeB64Url);

    await expect(
      webauthnService.verifyAuthentication(
        'cred-1',
        assertion.authenticatorData,
        assertion.clientDataJSON,
        assertion.signature,
      ),
    ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });

    expect(prisma.webAuthnCredential.update).not.toHaveBeenCalled();
  });

  it('rejects a tampered signature', async () => {
    const challengeB64Url = await seedChallenge();
    const assertion = buildAssertion(privateKey, challengeB64Url);
    const bad = Buffer.from(assertion.signature, 'base64');
    bad[bad.length - 1] ^= 0xff; // flip last byte

    await expect(
      webauthnService.verifyAuthentication(
        'cred-1',
        assertion.authenticatorData,
        assertion.clientDataJSON,
        bad.toString('base64'),
      ),
    ).rejects.toMatchObject({ code: 'SIGNATURE_INVALID' });
  });
});
