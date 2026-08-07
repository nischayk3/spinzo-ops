import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import type { OpsTask } from './opsTasks';

// Browser audio needs a user gesture before it can play; prime once from a tap handler.
let audioCtx: { ctx: AudioContext; resume: () => Promise<void> } | null = null;
const web = Platform.OS === 'web';

function chime() {
  if (!web || typeof window === 'undefined') return;
  try {
    if (!audioCtx) {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext;
      if (!AC) return;
      const ac = new AC();
      audioCtx = { ctx: ac, resume: () => ac.resume() };
    }
    audioCtx.resume().catch(() => {});
    const ctx = audioCtx.ctx;
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
