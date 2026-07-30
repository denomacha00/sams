import crypto from 'crypto';
import { prisma } from '../lib/prisma';
import { AppError } from '../middleware/errors';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface RegistrationOptions {
  challenge: string; // base64
  rp: { name: string; id: string };
  user: { id: string; name: string; displayName: string };
  pubKeyCredParams: Array<{ type: 'public-key'; alg: number }>;
  authenticatorSelection: {
    userVerification: 'required';
    residentKey: 'required';
    requireResidentKey: true;
  };
  timeout: number;
  excludeCredentials: Array<{ id: string; type: 'public-key' }>;
}

export interface AuthenticationOptions {
  challenge: string; // base64
  rpId: string;
  allowCredentials: Array<{ id: string; type: 'public-key'; transports?: string[] }>;
  userVerification: 'required';
  timeout: number;
}

// ─── In-memory challenge store (use Redis in production for multi-instance) ───

const challengeStore = new Map<string, { challenge: string; expiresAt: number }>();

function toBase64Url(value: string): string {
  return value.replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function storeChallenge(key: string, challenge: string): void {
  // Challenges expire after 5 minutes
  challengeStore.set(key, { challenge, expiresAt: Date.now() + 5 * 60 * 1000 });
}

function getAndDeleteChallenge(key: string): string | null {
  const entry = challengeStore.get(key);
  if (!entry) return null;
  challengeStore.delete(key);
  if (Date.now() > entry.expiresAt) return null;
  return entry.challenge;
}

// Clean up expired challenges periodically
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of challengeStore.entries()) {
    if (now > entry.expiresAt) challengeStore.delete(key);
  }
}, 60 * 1000);

// ─── WebAuthn Service ─────────────────────────────────────────────────────────

export class WebAuthnService {
  private rpName = 'SAMS';

  private resolveRpId(rpId?: string): string {
    return process.env.WEBAUTHN_RP_ID?.trim() || rpId || 'localhost';
  }

  /**
   * Generate registration options for a teacher to register their fingerprint.
   */
  async generateRegistrationOptions(userId: string, rpId?: string): Promise<RegistrationOptions> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, fullName: true, email: true, username: true, role: true },
    });

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    // Get existing credentials to exclude
    const existingCreds = await prisma.webAuthnCredential.findMany({
      where: { userId },
      select: { credentialId: true },
    });

    const challenge = crypto.randomBytes(32).toString('base64');
    storeChallenge(`reg:${userId}`, challenge);

    return {
      challenge,
      rp: { name: this.rpName, id: this.resolveRpId(rpId) },
      user: {
        id: Buffer.from(userId).toString('base64'),
        name: user.email || user.username || user.fullName,
        displayName: user.fullName,
      },
      pubKeyCredParams: [
        { type: 'public-key', alg: -7 },   // ES256
        { type: 'public-key', alg: -257 }, // RS256
      ],
      authenticatorSelection: {
        userVerification: 'required',
        residentKey: 'required',
        requireResidentKey: true,
      },
      timeout: 60000,
      excludeCredentials: existingCreds.map((c) => ({
        id: c.credentialId,
        type: 'public-key' as const,
      })),
    };
  }

  /**
   * Verify and store a new WebAuthn credential registration.
   */
  async verifyRegistration(
    userId: string,
    credentialId: string,
    publicKey: string, // base64
    clientDataJSON: string, // base64
    transports?: string[],
  ): Promise<{ success: boolean }> {
    // Verify the challenge
    const storedChallenge = getAndDeleteChallenge(`reg:${userId}`);
    if (!storedChallenge) {
      throw new AppError(400, 'CHALLENGE_EXPIRED', 'Registration challenge expired or not found');
    }

    // Decode clientDataJSON to verify challenge and origin
    const clientData = JSON.parse(Buffer.from(clientDataJSON, 'base64').toString('utf-8'));

    if (clientData.type !== 'webauthn.create') {
      throw new AppError(400, 'INVALID_RESPONSE', 'Invalid client data type');
    }

    // Verify challenge matches
    const receivedChallenge = clientData.challenge;
    // The challenge in clientDataJSON is base64url-encoded
    const expectedChallenge = storedChallenge
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');

    if (receivedChallenge !== expectedChallenge) {
      throw new AppError(400, 'CHALLENGE_MISMATCH', 'Challenge verification failed');
    }

    // Store the credential
    const publicKeyBuffer = Buffer.from(publicKey, 'base64');

    // Reject any key we won't be able to verify signatures against later. The
    // browser's getPublicKey() returns SPKI DER; anything else (e.g. a raw
    // attestationObject) is refused so we never store an unverifiable credential.
    try {
      crypto.createPublicKey({ key: publicKeyBuffer, format: 'der', type: 'spki' });
    } catch {
      throw new AppError(400, 'INVALID_PUBLIC_KEY', 'Unsupported public key format; please use a device that supports WebAuthn getPublicKey()');
    }

    await prisma.webAuthnCredential.create({
      data: {
        userId,
        credentialId,
        publicKey: publicKeyBuffer,
        counter: 0,
        deviceType: 'platform',
        transports: transports || ['internal'],
        backedUp: false,
      },
    });

    return { success: true };
  }

  /**
   * Generate authentication options (for login without specifying user first).
   * Returns all credentials for discoverable login, or specific user's credentials.
   */
  async generateAuthenticationOptions(userId?: string, rpId?: string): Promise<AuthenticationOptions> {
    const challenge = crypto.randomBytes(32).toString('base64');
    storeChallenge(`auth:${toBase64Url(challenge)}`, challenge);

    let allowCredentials: Array<{ id: string; type: 'public-key'; transports?: string[] }> = [];

    if (userId) {
      const creds = await prisma.webAuthnCredential.findMany({
        where: { userId },
        select: { credentialId: true, transports: true },
      });
      allowCredentials = creds.map((c) => ({
        id: c.credentialId,
        type: 'public-key' as const,
        transports: c.transports,
      }));
    }
    // If no userId, allowCredentials is empty = discoverable credential (resident key)

    return {
      challenge,
      rpId: this.resolveRpId(rpId),
      allowCredentials,
      userVerification: 'required',
      timeout: 60000,
    };
  }

  /**
   * Verify an authentication assertion and return the user if valid.
   */
  async verifyAuthentication(
    credentialId: string,
    authenticatorData: string, // base64
    clientDataJSON: string, // base64
    signature: string, // base64
  ): Promise<{ userId: string; user: any }> {
    // Find the credential
    const credential = await prisma.webAuthnCredential.findUnique({
      where: { credentialId },
      include: {
        user: {
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            schoolId: true,
            departmentId: true,
            classId: true,
            isLocked: true,
          },
        },
      },
    });

    if (!credential) {
      throw new AppError(401, 'CREDENTIAL_NOT_FOUND', 'WebAuthn credential not recognized');
    }

    // Decode clientDataJSON to verify type
    const clientData = JSON.parse(Buffer.from(clientDataJSON, 'base64').toString('utf-8'));

    if (clientData.type !== 'webauthn.get') {
      throw new AppError(400, 'INVALID_RESPONSE', 'Invalid client data type');
    }

    const storedChallenge = getAndDeleteChallenge(`auth:${clientData.challenge}`);
    if (!storedChallenge || toBase64Url(storedChallenge) !== clientData.challenge) {
      throw new AppError(400, 'CHALLENGE_MISMATCH', 'Authentication challenge verification failed');
    }

    // Verify authenticator data - extract sign count (bytes 33-36)
    const authDataBuffer = Buffer.from(authenticatorData, 'base64');
    const signCount = authDataBuffer.readUInt32BE(33);

    // Check sign count to detect cloned authenticators
    if (signCount > 0 && signCount <= credential.counter) {
      throw new AppError(401, 'REPLAY_DETECTED', 'Possible credential cloning detected');
    }

    // Cryptographically verify the assertion signature against the stored public
    // key. The signed data is authenticatorData || SHA-256(clientDataJSON), per
    // the WebAuthn spec. Without this check, anyone who knows a (non-secret)
    // credentialId and a valid challenge could forge a login. The public key was
    // stored at registration as SPKI DER (from the browser's getPublicKey()).
    const clientDataHash = crypto.createHash('sha256').update(Buffer.from(clientDataJSON, 'base64')).digest();
    const signedData = Buffer.concat([authDataBuffer, clientDataHash]);
    const signatureBuffer = Buffer.from(signature, 'base64');
    const publicKeyDer = Buffer.isBuffer(credential.publicKey)
      ? credential.publicKey
      : Buffer.from(credential.publicKey as unknown as Uint8Array);

    let signatureValid = false;
    try {
      const keyObject = crypto.createPublicKey({ key: publicKeyDer, format: 'der', type: 'spki' });
      const keyType = keyObject.asymmetricKeyType;
      if (keyType === 'ec') {
        // ES256 (P-256 + SHA-256). WebAuthn signatures are ASN.1 DER-encoded,
        // which is what Node's verifier expects for EC keys.
        signatureValid = crypto.verify('sha256', signedData, keyObject, signatureBuffer);
      } else if (keyType === 'rsa') {
        // RS256 (RSASSA-PKCS1-v1_5 + SHA-256).
        signatureValid = crypto.verify('sha256', signedData, keyObject, signatureBuffer);
      } else {
        throw new AppError(400, 'UNSUPPORTED_KEY', `Unsupported WebAuthn key type: ${keyType}`);
      }
    } catch (err) {
      if (err instanceof AppError) throw err;
      throw new AppError(401, 'SIGNATURE_INVALID', 'WebAuthn signature verification failed');
    }

    if (!signatureValid) {
      throw new AppError(401, 'SIGNATURE_INVALID', 'WebAuthn signature verification failed');
    }

    // Update counter and lastUsedAt
    await prisma.webAuthnCredential.update({
      where: { id: credential.id },
      data: {
        counter: signCount,
        lastUsedAt: new Date(),
      },
    });

    if (credential.user.isLocked) {
      await prisma.user.update({
        where: { id: credential.user.id },
        data: { isLocked: false, failedLoginCount: 0, failedLoginWindowStart: null },
      });
    }

    return {
      userId: credential.userId,
      user: {
        id: credential.user.id,
        fullName: credential.user.fullName,
        email: credential.user.email,
        role: credential.user.role,
        schoolId: credential.user.schoolId,
        departmentId: credential.user.departmentId,
        classId: credential.user.classId,
      },
    };
  }
}

// ─── Singleton Export ─────────────────────────────────────────────────────────

export const webauthnService = new WebAuthnService();
