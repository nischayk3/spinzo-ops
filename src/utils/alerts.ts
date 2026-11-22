import { Platform } from 'react-native';
import * as Speech from 'expo-speech';
import type { OpsTask } from './opsTasks';
import { buildHindiVoicePrompt } from './voiceScripts';

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
let voiceLoopGeneration = 0;
let voiceTimeout: ReturnType<typeof setTimeout> | null = null;

function stopAlarmSoundOnly() {
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

/** Play a short non-looping attention chime that stops cleanly after durationMs without touching voice timers */
function playAttentionChime(durationMs: number = 1500) {
  shouldBePlaying = true;
  if (singleLoopTimeout) {
    clearTimeout(singleLoopTimeout);
    singleLoopTimeout = null;
  }

  if (web) {
    const ac = ensureAudioCtx();
    if (ac) {
      try {
        ac.resume().catch(() => {});
        const now = ac.ctx.currentTime;
        playTone(ac.ctx, 784, 'triangle', now, 0.22, 0.3);
        playTone(ac.ctx, 988, 'triangle', now + 0.2, 0.22, 0.3);
        playTone(ac.ctx, 1318, 'triangle', now + 0.4, 0.35, 0.35);
      } catch {
        // best-effort
      }
    }
  }

  try {
    alarmSound.loop = false;
    if (typeof alarmSound.seekTo === 'function') {
      alarmSound.seekTo(0);
    } else if (typeof alarmSound.currentTime !== 'undefined') {
      alarmSound.currentTime = 0;
    }
    try { alarmSound.play(); } catch { /* silence AbortError */ }

    singleLoopTimeout = setTimeout(() => {
      if (shouldBePlaying) {
        stopAlarmSoundOnly();
      }
    }, durationMs);
  } catch (e) {
    console.log('Failed to play attention chime', e);
  }
}

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

  // Web audio chime fallback: play crisp synthesized chime on Web browsers
  if (web) {
    const ac = ensureAudioCtx();
    if (ac) {
      try {
        ac.resume().catch(() => {});
        const now = ac.ctx.currentTime;
        playTone(ac.ctx, 784, 'triangle', now, 0.22, 0.3);
        playTone(ac.ctx, 988, 'triangle', now + 0.2, 0.22, 0.3);
        playTone(ac.ctx, 1318, 'triangle', now + 0.4, 0.35, 0.35);
      } catch (e) {
        // best-effort
      }
    }
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
    } else {
      // Loop failsafe: never ring indefinitely — auto-stop after 30 seconds max
      singleLoopTimeout = setTimeout(() => {
        if (shouldBePlaying) {
          stopAlarm();
        }
      }, 30000);
    }
  } catch (e) {
    console.log('Failed to play alarm sound', e);
  }
}

/** Instantly kill both the siren and any active Hindi TTS voice alert loop */
export async function stopAlarm() {
  stopAlarmSoundOnly();
  stopVoiceAlerts();
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
    Speech.speak(text, { language: 'en-IN', rate: 1.0 });
  } catch (err) {
    console.warn('Speech error', err);
  }
}

/** Speak Devanagari Hindi clearly using hi-IN voice, cancelling any prior speech first */
export function speakHindi(text: string) {
  const trimmed = (text || '').trim();
  if (!trimmed) return;
  try {
    Speech.stop();
  } catch {
    // best-effort
  }
  try {
    Speech.speak(trimmed, { language: 'hi-IN', rate: 0.90, pitch: 1.0 });
  } catch (err) {
    console.warn('Hindi speech error', err);
  }
}

/** Cancel any pending Hindi voice repeat timers and stop active TTS immediately */
export function stopVoiceAlerts() {
  voiceLoopGeneration += 1;
  if (voiceTimeout) {
    clearTimeout(voiceTimeout);
    voiceTimeout = null;
  }
  try {
    Speech.stop();
  } catch {
    // best-effort
  }
}

/**
 * Play a 1.5s attention chime, silence the chime completely, and then speak the Hindi prompt
 * clearly with zero siren overlap. Repeats up to `maxRepeats` times (default 3) every `repeatEveryMs` (default 8000ms).
 */
export function startVoiceAlertLoop(
  voiceText: string,
  options?: { repeatEveryMs?: number; maxRepeats?: number }
) {
  stopVoiceAlerts();
  stopAlarmSoundOnly();

  const trimmed = (voiceText || '').trim();
  if (!trimmed) return;

  const repeatEveryMs = options?.repeatEveryMs ?? 8000;
  const maxRepeats = Math.max(1, options?.maxRepeats ?? 3);
  const gen = ++voiceLoopGeneration;

  playAttentionChime(1500);

  let spokenCount = 0;
  const speakNext = () => {
    if (gen !== voiceLoopGeneration) return;
    stopAlarmSoundOnly();
    speakHindi(trimmed);
    spokenCount += 1;
    if (spokenCount < maxRepeats) {
      voiceTimeout = setTimeout(speakNext, repeatEveryMs);
    } else {
      voiceTimeout = null;
    }
  };

  voiceTimeout = setTimeout(speakNext, 1500);
}

export function primeAlerts() {
  confirmBeep();
}

export function announceNewOrder() {
  startVoiceAlertLoop(buildHindiVoicePrompt({ kind: 'new_order' }), { maxRepeats: 1 });
}

export function announceAssignedPickup(
  task: Pick<OpsTask, 'orderId' | 'pickupAddress'> & {
    tokenNumber?: unknown;
    tokens?: Record<string, unknown> | null;
    isExpress?: boolean;
  }
) {
  const prompt = buildHindiVoicePrompt({
    kind: 'pickup',
    tokenNumber: task?.tokenNumber,
    tokensMap: task?.tokens,
    isExpress: task?.isExpress,
    locality: typeof task?.pickupAddress === 'string' ? task.pickupAddress : undefined,
  });
  speakHindi(prompt);
}

export function announceAssignedDelivery(
  _orderId: string,
  _address: string,
  options?: {
    tokenNumber?: unknown;
    tokensMap?: Record<string, unknown> | null;
    isExpress?: boolean;
  }
) {
  const prompt = buildHindiVoicePrompt({
    kind: 'delivery',
    tokenNumber: options?.tokenNumber,
    tokensMap: options?.tokensMap,
    isExpress: options?.isExpress,
  });
  speakHindi(prompt);
}

/** Alert for order stage transition — lighter chime + TTS */
export function announceStageTransition(orderId: string, stageName: string) {
  lifecycleChime();
  const shortId = (orderId || '').slice(-6).toUpperCase() || '------';
  speak(`Order ${shortId} moved to ${stageName}`);
}

/** Alert for washing machine chemical additions (3m detergent, 21m softener, 36m complete) */
export function announceWasherMilestone(
  _orderId: string,
  milestone: 'detergent' | 'softener' | 'complete',
  tokenNumber?: unknown,
  tokensMap?: Record<string, unknown> | null
) {
  const prompt = buildHindiVoicePrompt({
    kind: 'nudge',
    step: 'getting_washed',
    phase: milestone === 'complete' ? 'started' : milestone,
    tokenNumber,
    tokensMap,
  });
  startVoiceAlertLoop(prompt, { maxRepeats: 1 });
}

// Dedupe supervisor "skipped order" alarms so we don't re-ring for the same order.
const skippedNotified = new Set<string>();

/** Ring the "You skipped an order" alert for an inbound order the floor hasn't claimed. */
export function announceSkippedOrder(orderId: string) {
  if (skippedNotified.has(orderId)) return;
  skippedNotified.add(orderId);
  // Short one-shot burst (loop:false stops after ~2.5s) — do NOT use a looping siren.
  dramaticChime(false);
  const shortId = (orderId || '').slice(-6).toUpperCase() || '------';
  speak(`You skipped order ${shortId}`);
}

/** Confirmation sound for successful actions */
export function confirmAction() {
  confirmBeep();
}
