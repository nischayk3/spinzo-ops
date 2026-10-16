import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

// Configure notification behavior when app is in foreground/background
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
    priority: Notifications.AndroidNotificationPriority.MAX,
  }),
});

export const CHANNEL_ID = 'order_assignment';

/**
 * Configure high-priority Android notification channel with loud alarm and vibration.
 */
export async function setupNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;
  try {
    await Notifications.setNotificationChannelAsync(CHANNEL_ID, {
      name: 'Order Assignment Alerts',
      description: 'Loud high-priority alerts for new order assignments',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 500, 250, 500, 250, 500],
      sound: 'alarm.wav',
      enableVibrate: true,
      enableLights: true,
      lightColor: '#994bff',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
      bypassDnd: true,
      showBadge: true,
    });
  } catch (err) {
    console.warn('[Notifications] Channel setup error:', err);
  }
}

/**
 * Request notification permissions from the user.
 */
export async function requestNotificationPermissions(): Promise<boolean> {
  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    let finalStatus = existingStatus;
    if (existingStatus !== 'granted') {
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }
    return finalStatus === 'granted';
  } catch (err) {
    console.warn('[Notifications] Permission request error:', err);
    return false;
  }
}

export interface AssignmentNotificationParams {
  orderId: string;
  orderShortId?: string;
  taskType: string; // e.g. "Instant Pickup", "Delivery", "Washing Stage"
  address?: string;
  slotText?: string;
  isInstant?: boolean;
}

/**
 * Show a prominent, large Heads-Up notification on Android with alarm sound.
 */
export async function triggerAssignmentNotification(params: AssignmentNotificationParams): Promise<void> {
  const short = params.orderShortId || params.orderId.slice(-6).toUpperCase();
  const title = params.isInstant 
    ? `⚡ INSTANT PICKUP ASSIGNED! #${short}` 
    : `🚨 NEW ORDER ASSIGNED! #${short}`;

  let body = `${params.taskType} • #${short}`;
  if (params.slotText) {
    body += `\n⏰ ${params.slotText}`;
  }
  if (params.address) {
    body += `\n📍 ${params.address}`;
  }
  body += '\nTap to open and accept now';

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        subtitle: `#${short}`,
        body,
        sound: 'alarm.wav',
        priority: Notifications.AndroidNotificationPriority.MAX,
        color: params.isInstant ? '#f59e0b' : '#994bff',
        data: {
          orderId: params.orderId,
          type: 'assignment',
        },
      },
      trigger: null, // show immediately
    });
  } catch (err) {
    console.warn('[Notifications] Failed to schedule notification:', err);
  }
}

/**
 * Dismiss all active assignment notifications once accepted.
 */
export async function clearAssignmentNotifications(): Promise<void> {
  try {
    await Notifications.dismissAllNotificationsAsync();
  } catch {
    // non-fatal
  }
}

export interface StageNudgeNotificationParams {
  orderId: string;
  orderShortId?: string;
  title: string;
  message: string;
  step?: string;
  phase?: string;
}

/**
 * Show a prominent Stage Nudge Heads-Up notification on Android / Web with alarm sound.
 */
export async function triggerStageNudgeNotification(params: StageNudgeNotificationParams): Promise<void> {
  const short = params.orderShortId || params.orderId.slice(-6).toUpperCase();
  const title = `⏰ ${params.title} #${short}`;
  const body = `${params.message}\nTap to respond now.`;

  // Web browser desktop notification
  if (Platform.OS === 'web' && typeof window !== 'undefined' && 'Notification' in window) {
    if (Notification.permission === 'granted') {
      try {
        new Notification(title, { body });
      } catch (e) {
        console.warn('Web notification error:', e);
      }
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(p => {
        if (p === 'granted') {
          try {
            new Notification(title, { body });
          } catch {}
        }
      });
    }
  }

  try {
    await Notifications.scheduleNotificationAsync({
      content: {
        title,
        subtitle: `#${short}`,
        body,
        sound: 'alarm.wav',
        priority: Notifications.AndroidNotificationPriority.MAX,
        color: '#f59e0b',
        data: {
          orderId: params.orderId,
          type: 'stage_nudge',
          step: params.step,
          phase: params.phase,
        },
      },
      trigger: null,
    });
  } catch (err) {
    console.warn('[Notifications] Failed to schedule stage nudge notification:', err);
  }
}

export interface ScheduleStageNudgeParams {
  orderId: string;
  processId: string;
  step: 'getting_washed' | 'getting_dried';
  phase: 'accepted' | 'started';
  delaySeconds: number;
  title: string;
  message: string;
}

/**
 * Schedule future background notification via Android OS AlarmManager / NotificationManager.
 * This fires exactly at the delay even when app is closed or device is locked.
 */
export async function scheduleStageNudgeTimer(params: ScheduleStageNudgeParams): Promise<string | null> {
  const identifier = `nudge_${params.processId}_${params.step}_${params.phase}`;
  const short = params.orderId.slice(-6).toUpperCase();
  const title = `⏰ ${params.title} #${short}`;
  const body = `${params.message}\nTap to respond now.`;

  try {
    await Notifications.cancelScheduledNotificationAsync(identifier).catch(() => {});

    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title,
        subtitle: `#${short}`,
        body,
        sound: 'alarm.wav',
        priority: Notifications.AndroidNotificationPriority.MAX,
        color: '#f59e0b',
        data: {
          type: 'stage_nudge',
          orderId: params.orderId,
          processId: params.processId,
          step: params.step,
          phase: params.phase,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: Math.max(1, Math.floor(params.delaySeconds)),
      },
    });
    return identifier;
  } catch (err) {
    console.warn('[Notifications] Failed to schedule future stage nudge timer:', err);
    return null;
  }
}

/**
 * Cancel any pending scheduled stage nudge notifications.
 */
export async function cancelStageNudgeTimer(processId: string, step?: string): Promise<void> {
  try {
    const phases = ['accepted', 'started'];
    const steps = step ? [step] : ['getting_washed', 'getting_dried'];
    for (const s of steps) {
      for (const p of phases) {
        await Notifications.cancelScheduledNotificationAsync(`nudge_${processId}_${s}_${p}`).catch(() => {});
      }
    }
  } catch {
    // non-fatal
  }
}


