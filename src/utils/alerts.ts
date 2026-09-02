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

// ────────────────────────────────────────────────────────────────────────────
// Dramatic Order Alert — multi-tone ascending arpeggio, Swiggy/Zomato style
// ────────────────────────────────────────────────────────────────────────────

function playTone(ctx: AudioContext, freq: number, type: OscillatorType, startTime: number, duration: number, vol: number) {
  const osc = ctx.createOscillator();
  const gainNode = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  
  // Sharp envelope for digital beep sound
  gainNode.gain.setValueAtTime(0, startTime);
  gainNode.gain.linearRampToValueAtTime(vol, startTime + 0.01);
  gainNode.gain.setValueAtTime(vol, startTime + duration - 0.01);
  gainNode.gain.linearRampToValueAtTime(0, startTime + duration);
  
  osc.connect(gainNode);
  gainNode.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

import { Audio } from 'expo-av';

// Pre-load the sound instance so it plays instantly
let alarmSound: Audio.Sound | null = null;
async function initAlarm() {
  try {
    const { sound } = await Audio.Sound.createAsync(require('../../assets/sounds/alarm.mp3'));
    alarmSound = sound;
  } catch (e) {
    console.log('Failed to load alarm sound', e);
  }
}
// Init async in background
initAlarm();

/** Dramatic order alert — Plays loud emergency MP3 */
async function dramaticChime() {
  try {
    if (!alarmSound) {
      // If it hasn't loaded yet, try loading it on the fly
      const { sound } = await Audio.Sound.createAsync(require('../../assets/sounds/alarm.mp3'));
      alarmSound = sound;
    }
    
    // Web requires user interaction before Audio can play.
    // Ensure we stop any currently playing instance before playing again.
    await alarmSound.stopAsync();
    await alarmSound.playAsync();
  } catch (e) {
    // Audio might fail if user hasn't interacted with the page yet on Web
    console.log('Failed to play alarm sound', e);
  }
}

/** Lighter chime for lifecycle stage transitions */
function lifecycleChime() {
  const ac = ensureAudioCtx();
  if (!ac) return;
  try {
    ac.resume().catch(() => {});
    const ctx = ac.ctx;
    const now = ctx.currentTime;
    // Two-note gentle chime: G5 → C6
    playNote(ctx, 783.99, now, 0.15, 0.25);
    playNote(ctx, 1046.50, now + 0.18, 0.2, 0.25);
  } catch (e) {
    // best-effort
  }
}

/** Simple confirmation beep */
function confirmBeep() {
  const ac = ensureAudioCtx();
  if (!ac) return;
  try {
    ac.resume().catch(() => {});
    const ctx = ac.ctx;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 1200;
    gain.gain.value = 0.15;
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.12);
  } catch (e) {
    // best-effort
  }
}

function speak(text: string) {
  try {
    // expo-speech has no availability check; speak() is best-effort and guarded below.
    Speech.speak(text, { language: 'en-IN', rate: 1.1 });
  } catch (e) {
    // no-op
  }
}

export function primeAlerts() {
  confirmBeep();
}

export function announceNewOrder() {
  dramaticChime();
  speak('New order placed');
}

export function announceAssignedPickup(task: Pick<OpsTask, 'orderId' | 'pickupAddress'>) {
  dramaticChime();
  speak(`Pickup assigned. Order ${task.orderId.slice(-6).toUpperCase()}. ${task.pickupAddress || ''}`);
}

export function announceAssignedDelivery(orderId: string, address: string) {
  dramaticChime();
  speak(`Delivery assigned. Order ${orderId.slice(-6).toUpperCase()}. ${address || ''}`);
}

/** Alert for order stage transition — lighter chime + TTS */
export function announceStageTransition(orderId: string, stageName: string) {
  lifecycleChime();
  speak(`Order ${orderId.slice(-6).toUpperCase()} moved to ${stageName}`);
}

/** Confirmation sound for successful actions */
export function confirmAction() {
  confirmBeep();
}
