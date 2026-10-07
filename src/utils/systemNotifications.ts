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
