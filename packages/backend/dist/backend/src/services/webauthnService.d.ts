export interface RegistrationOptions {
    challenge: string;
    rp: {
        name: string;
        id: string;
    };
    user: {
        id: string;
        name: string;
        displayName: string;
    };
    pubKeyCredParams: Array<{
        type: 'public-key';
        alg: number;
    }>;
    authenticatorSelection: {
        authenticatorAttachment: 'platform';
        userVerification: 'required';
        residentKey: 'preferred';
    };
    timeout: number;
    excludeCredentials: Array<{
        id: string;
        type: 'public-key';
    }>;
}
export interface AuthenticationOptions {
    challenge: string;
    rpId: string;
    allowCredentials: Array<{
        id: string;
        type: 'public-key';
        transports?: string[];
    }>;
    userVerification: 'preferred';
    timeout: number;
}
export declare class WebAuthnService {
    private rpName;
    private rpId;
    /**
     * Generate registration options for a teacher to register their fingerprint.
     */
    generateRegistrationOptions(userId: string): Promise<RegistrationOptions>;
    /**
     * Verify and store a new WebAuthn credential registration.
     */
    verifyRegistration(userId: string, credentialId: string, publicKey: string, // base64
    clientDataJSON: string, // base64
    transports?: string[]): Promise<{
        success: boolean;
    }>;
    /**
     * Generate authentication options (for login without specifying user first).
     * Returns all credentials for discoverable login, or specific user's credentials.
     */
    generateAuthenticationOptions(userId?: string): Promise<AuthenticationOptions>;
    /**
     * Verify an authentication assertion and return the user if valid.
     */
    verifyAuthentication(credentialId: string, authenticatorData: string, // base64
    clientDataJSON: string, // base64
    signature: string): Promise<{
        userId: string;
        user: any;
    }>;
}
export declare const webauthnService: WebAuthnService;
//# sourceMappingURL=webauthnService.d.ts.map