import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

export type VerifyPickupResult =
  | { ok: true; alreadyDone?: boolean }
  | { ok: false; error: 'unauthorized' | 'invalid_input' | 'invalid_otp' | 'invalid_state' | 'not_found' | 'server_error' | string };

interface OpsStatusSyncRequest {
  orderId: string;
  otp: string;
  tokenNumber?: string;
}

/**
 * Invoke the opsStatusSync callable to server-verify a pickup OTP.
 * Rejects with a message on network failure or a non-ok result.
 */
export async function verifyPickupOTP(
  orderId: string,
  otp: string,
  tokenNumber?: string
): Promise<VerifyPickupResult> {
  try {
    const callable = httpsCallable<OpsStatusSyncRequest, VerifyPickupResult>(functions, 'opsStatusSync');
    const res = await callable({ orderId, otp, tokenNumber });
    return res.data;
  } catch (err: any) {
    // httpsCallable surfaces {code, message, details} on a thrown error;
    // the function returns {ok:false} as a normal response, so a throw here
    // is a transport/network/HttpsError issue. Surface the message.
    const msg = err?.message || 'Verification request failed';
    return { ok: false, error: `request_failed: ${msg}` };
  }
}
