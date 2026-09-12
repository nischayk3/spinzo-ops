import { httpsCallable } from 'firebase/functions';
import { functions } from '../config/firebase';

export type VerifyPickupResult =
  | { ok: true; alreadyDone?: boolean }
  | { ok: false; error: 'unauthorized' | 'invalid_input' | 'invalid_otp' | 'invalid_state' | 'not_found' | 'server_error' | string };

interface OpsStatusSyncRequest {
  orderId: string;
  otp: string;
  tokenNumber?: string;
  tokens?: Record<string, string>;
}

/**
 * Invoke the opsStatusSync callable to server-verify a pickup OTP.
 * Rejects with a message on network failure or a non-ok result.
 */
export async function verifyPickupOTP(
  orderId: string,
  otp: string,
  tokenNumber?: string,
  tokens?: Record<string, string>
): Promise<VerifyPickupResult> {
  try {
    const callable = httpsCallable<OpsStatusSyncRequest, VerifyPickupResult>(functions, 'opsStatusSync');
    const res = await callable({ orderId, otp, tokenNumber, tokens });
    return res.data;
  } catch (err: any) {
    // httpsCallable surfaces {code, message, details} on a thrown error;
    // the function returns {ok:false} as a normal response, so a throw here
    // is a transport/network/HttpsError issue. Surface the message.
    const msg = err?.message || 'Verification request failed';
    return { ok: false, error: `request_failed: ${msg}` };
  }
}

export async function verifyStoreOTP(
  orderId: string,
  otp: string
): Promise<VerifyPickupResult> {
  try {
    const callable = httpsCallable<{ action: string; orderId: string; otp: string }, VerifyPickupResult>(functions, 'opsStatusSync');
    const res = await callable({ action: 'verifyStoreOTP', orderId, otp });
    return res.data;
  } catch (err: any) {
    return { ok: false, error: err?.message || 'network_error' };
  }
}

export async function acceptTask(orderId: string, isDelivery?: boolean): Promise<{ ok: boolean; error?: string }> {
  try {
    const callable = httpsCallable<{ action: string; orderId: string; isDelivery?: boolean }, { ok: boolean; error?: string }>(functions, 'opsStatusSync');
    const res = await callable({ action: 'acceptTask', orderId, isDelivery: !!isDelivery });
    return res.data;
  } catch (err: any) {
    return { ok: false, error: err?.message || 'network_error' };
  }
}
