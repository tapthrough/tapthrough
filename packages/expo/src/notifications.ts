import * as Notifications from 'expo-notifications'
import { Platform } from 'react-native'
import type { NotificationsAdapter } from './core/ideas.js'

/** Taps already handled, so the one that launched the app isn't handled twice. */
const handled = new Set<string>()

/**
 * "PR ready to review" notifications for Tapthrough, with `expo-notifications`:
 * `<Tapthrough notifications={tapthroughNotifications}>`. Nothing is asked
 * until a reviewer taps Notify Me in the Review panel.
 */
export const tapthroughNotifications: NotificationsAdapter = {
  async granted() {
    return (await Notifications.getPermissionsAsync()).granted
  },

  async enable(projectId) {
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default',
        importance: Notifications.AndroidImportance.DEFAULT,
      })
    }
    let permission = await Notifications.getPermissionsAsync()
    if (!permission.granted && permission.canAskAgain) {
      permission = await Notifications.requestPermissionsAsync()
    }
    if (!permission.granted) return null
    return (await Notifications.getExpoPushTokenAsync({ projectId })).data
  },

  onOpen(handler) {
    const handle = (response: Notifications.NotificationResponse | null) => {
      if (!response) return
      const id = response.notification.request.identifier
      if (handled.has(id)) return
      handled.add(id)
      handler((response.notification.request.content.data ?? {}) as Record<string, unknown>)
    }
    const subscription = Notifications.addNotificationResponseReceivedListener(handle)
    void Notifications.getLastNotificationResponseAsync().then(handle)
    return () => subscription.remove()
  },
}
