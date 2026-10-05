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

import { createAudioPlayer } from 'expo-audio';

// createAudioPlayer is synchronous and returns an AudioPlayer instance immediately
const alarmSound = createAudioPlayer(require('../../assets/sounds/alarm.mp3'));
let shouldBePlaying = false;
let singleLoopTimeout: ReturnType<typeof setTimeout> | null = null;

/** Unlock Audio Context for web browsers safely */
export async function unlockAudio() {
  const ac = ensureAudioCtx();
  if (ac) ac.resume().catch(() => {});

  try {
    if (ac?.ctx) {
      const osc = ac.ctx.createOscillator();
      const gain = ac.ctx.createGain();
      gain.gain.value = 0.0001;
      osc.connect(gain);
      gain.connect(ac.ctx.destination);
      osc.start();
      osc.stop(ac.ctx.currentTime + 0.05);
    }
  } catch (e) {
    console.log('Audio unlock failed:', e);
  }
}

/** Start a looping or single-burst siren using the MP3 file */
export async function dramaticChime(loop: boolean = true) {
  shouldBePlaying = true;
  if (singleLoopTimeout) {
    clearTimeout(singleLoopTimeout);
    singleLoopTimeout = null;
  }

  try {
    alarmSound.loop = loop;
    if (typeof alarmSound.seekTo === 'function') {
        alarmSound.seekTo(0);
    } else if (typeof alarmSound.currentTime !== 'undefined') {
        alarmSound.currentTime = 0;
    }
    try { alarmSound.play(); } catch (e) { /* silence AbortError */ }

    // If we only want a single loop (e.g. for Supervisor new order),
    // we manually stop it after 2.5 seconds (roughly one MP3 loop).
    if (!loop) {
      singleLoopTimeout = setTimeout(() => {
        if (!loop && shouldBePlaying) {
          stopAlarm();
        }
      }, 2500);
    }
  } catch (e) {
    console.log('Failed to play alarm sound', e);
  }
}

/** Instantly kill the siren */
export async function stopAlarm() {
  shouldBePlaying = false;
  if (singleLoopTimeout) {
    clearTimeout(singleLoopTimeout);
    singleLoopTimeout = null;
  }
  try {
    alarmSound.pause();
    alarmSound.loop = false;
    if (typeof alarmSound.seekTo === 'function') {
      alarmSound.seekTo(0);
    } else if (typeof alarmSound.currentTime !== 'undefined') {
      alarmSound.currentTime = 0;
    }
  } catch (e) {
    console.log('Failed to stop alarm sound', e);
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
    playTone(ctx, 783.99, 'sine', now, 0.15, 0.25);
    playTone(ctx, 1046.50, 'sine', now + 0.18, 0.2, 0.25);
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
    // Speech.speak(text, { language: 'en-IN', rate: 1.1 });
  } catch (err) {
    console.warn('Speech error', err);
  }
}

export function primeAlerts() {
  confirmBeep();
}

export function announceNewOrder() {
  dramaticChime(false);
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

// Dedupe supervisor "skipped order" alarms so we don't re-ring for the same order.
const skippedNotified = new Set<string>();

/** Ring the "You skipped an order" alert for an inbound order the floor hasn't claimed. */
export function announceSkippedOrder(orderId: string) {
  if (skippedNotified.has(orderId)) return;
  skippedNotified.add(orderId);
  // Short one-shot burst (loop:false stops after ~2.5s) — do NOT use a looping siren.
  dramaticChime(false);
  speak(`You skipped order ${orderId.slice(-6).toUpperCase()}`);
}

/** Confirmation sound for successful actions */
export function confirmAction() {
  confirmBeep();
}
