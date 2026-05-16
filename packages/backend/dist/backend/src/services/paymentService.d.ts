export interface STKPushParams {
    phone: string;
    amount: number;
    planTier: string;
    accountReference?: string;
}
export interface MpesaCallbackData {
    Body: {
        stkCallback: {
            MerchantRequestID: string;
            CheckoutRequestID: string;
            ResultCode: number;
            ResultDesc: string;
            CallbackMetadata?: {
                Item: Array<{
                    Name: string;
                    Value?: string | number;
                }>;
            };
        };
    };
}
export declare class PaymentService {
    /**
     * Get M-Pesa OAuth token.
     */
    private getAccessToken;
    /**
     * Generate M-Pesa timestamp and password.
     */
    private generateTimestampAndPassword;
    /**
     * Initiate an M-Pesa STK Push.
     */
    initiateSTKPush(schoolId: string, params: STKPushParams): Promise<{
        paymentId: string;
        checkoutRequestId: any;
        message: any;
    }>;
    /**
     * Handle M-Pesa callback.
     */
    handleCallback(callbackData: MpesaCallbackData): Promise<void>;
    /**
     * Get invoice/payment details.
     */
    getInvoice(schoolId: string, paymentId: string): Promise<{
        id: string;
        schoolId: string;
        amount: number;
        planTier: import(".prisma/client").$Enums.PlanTier;
        mpesaReceiptNumber: string | null;
        status: import(".prisma/client").$Enums.PaymentStatus;
        completedAt: Date | null;
        invoiceUrl: string | null;
        initiatedAt: Date;
    }>;
    /**
     * List payments for a school.
     */
    listPayments(schoolId: string): Promise<{
        id: string;
        schoolId: string;
        phone: string;
        planTier: import(".prisma/client").$Enums.PlanTier;
        status: import(".prisma/client").$Enums.PaymentStatus;
        mpesaCheckoutId: string | null;
        mpesaReceiptNumber: string | null;
        amount: number;
        invoiceUrl: string | null;
        initiatedAt: Date;
        completedAt: Date | null;
    }[]>;
}
export declare const paymentService: PaymentService;
//# sourceMappingURL=paymentService.d.ts.map