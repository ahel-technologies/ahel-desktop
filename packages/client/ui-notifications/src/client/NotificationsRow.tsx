/** General Settings row: notifications on or off. */
import { Switch } from '@ahel/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@ahel/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type { NotificationSettings } from './watcher.ts'
import css from './NotificationsRow.module.css'

/** Registration-side preference and writer. */
export interface NotificationsRowInjected {
  hooks: {
    /** Current preference, bound as useNotificationSettings. */
    notificationSettings: ObservableSnapshot<NotificationSettings>
  }
  /** Replace the saved preference. */
  setNotificationSettings(next: NotificationSettings): void
}

/** Full Settings-row props. */
export type NotificationsRowProps =
  PropsRuntime<'settings.general.item'> & PropsLocale<'notifications'> & InjectFace<NotificationsRowInjected>

/**
 * Render the notifications switch.
 * @param props - composed Settings slot props.
 * @returns the row.
 */
export function NotificationsRow({ useNotificationSettings, setNotificationSettings, t }: NotificationsRowProps) {
  const enabled = useNotificationSettings(value => value.enabled)
  return <div className={css.row}>
    <div>
      <div className={css.title}>{t('settings.title')}</div>
      <div className={css.description}>{t('settings.description')}</div>
    </div>
    <Switch checked={enabled} label={t('settings.title')}
      onChange={(next) => { setNotificationSettings({ enabled: next }) }} />
  </div>
}
