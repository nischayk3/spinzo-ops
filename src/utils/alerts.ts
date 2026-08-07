import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import type { OpsTask } from './opsTasks';

// Browser audio needs a user gesture before it can play; prime once from a tap handler.
let audioCtx: { ctx: AudioContext; resume: () => Promise<void> } | null = null;
const web = Platform.OS === 'web';

function ensureAudioCtx(): { ctx: AudioContext; resume: () => Promise<void> } | null {
  if (!web || typeof window === 'undefined') return null;
  try {
    if (!audioCtx) {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return null;
      const ac = new AC();
      audioCtx = { ctx: ac, resume: () => ac.resume() };
    }
    return audioCtx;
  } catch (e) {
    return null;
  }
}

// Unlock the AudioContext on the first user interaction anywhere on the page,
// so snapshot-triggered chimes (which fire outside a gesture) still sound.
function installWebGesturePrime() {
  if (!web || typeof window === 'undefined') return;
  const prime = () => {
    const ac = ensureAudioCtx();
    ac?.resume().catch(() => {});
    for (const evt of ['pointerdown', 'touchstart', 'keydown'] as const) {
      window.removeEventListener(evt, prime);
    }
  };
  for (const evt of ['pointerdown', 'touchstart', 'keydown'] as const) {
    window.addEventListener(evt, prime);
  }
}
installWebGesturePrime();

function chime() {
  const ac = ensureAudioCtx();
  if (!ac) return;
  try {
    ac.resume().catch(() => {});
    const ctx = ac.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.value = 0.18;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch (e) {
    // Alerts are best-effort; never crash the UI.
  }
}

function speak(text: string) {
  try {
    // expo-speech has no availability check; speak() is best-effort and guarded below.
    Speech.speak(text, { language: 'en-IN' });
  } catch (e) {
    // no-op
  }
}

export function primeAlerts() {
  chime();
}

export function announceNewOrder() {
  chime();
  speak('New order placed');
}

export function announceAssignedPickup(task: Pick<OpsTask, 'orderId' | 'pickupAddress'>) {
  chime();
  speak(`Pickup assigned. Order ${task.orderId.slice(-6).toUpperCase()}. ${task.pickupAddress || ''}`);
}
