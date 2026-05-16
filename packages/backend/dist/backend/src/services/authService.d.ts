export interface TokenPair {
    accessToken: string;
    refreshToken: string;
}
export declare class AuthService {
    /**
     * Authenticate a user by schoolCode + identifier (email or admissionNumber) + password.
     *
     * Flow:
     * 1. Find school by schoolCode
     * 2. Find user by email OR admissionNumber within that school
     * 3. Check isLocked
     * 4. Enforce 5-attempt / 15-min lockout window
     * 5. Compare bcrypt password hash
     * 6. On success: generate token pair, store hashed refresh token, log USER_LOGIN, reset failed count
     * 7. On failure: increment failed count, lock account if threshold reached
     *
     * Requirements: 3.1, 3.6, 3.7, 3.8, 19.2, 19.5
     */
    login(schoolCode: string, identifier: string, password: string): Promise<TokenPair>;
    /**
     * Exchange a valid refresh token for a new token pair (rotation).
     * Verifies JWT signature, looks up hashed token in DB, deletes old token,
     * inserts new token.
     *
     * Requirements: 3.8
     */
    refresh(refreshToken: string): Promise<TokenPair>;
    /**
     * Invalidate a refresh token and log USER_LOGOUT.
     *
     * Requirements: 3.7
     */
    logout(userId: string, refreshToken: string): Promise<void>;
    /**
     * Lock a user account and notify the School Admin via NotificationService.
     *
     * Requirements: 19.5
     */
    lockAccount(userId: string): Promise<void>;
    /**
     * Generate tokens for a user by ID (used by WebAuthn login flow).
     * Stores the refresh token and updates lastLoginAt.
     */
    generateTokensForUser(userId: string): Promise<TokenPair>;
    /**
     * Generate a JWT access token and refresh token for the given user.
     */
    private _generateTokenPair;
}
export declare const authService: AuthService;
//# sourceMappingURL=authService.d.ts.map