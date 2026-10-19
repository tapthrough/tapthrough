import Constants from 'expo-constants'
import { createLaunchController } from './core/controller.js'

/** One controller per app, shared by `<Tapthrough>` and `redirectSystemPath`. */
export const controller = createLaunchController()

export const DEFAULT_API_URL = 'https://tapthrough.dev'

export interface PluginConfig {
  enabled: boolean
  seedHookUrl: string | undefined
  /** Tapthrough's base URL, where reports are sent. */
  apiUrl: string
}

/** What the config plugin wrote into `extra.tapthrough` at build time. */
export function pluginConfig(): PluginConfig {
  const extra = Constants.expoConfig?.extra?.tapthrough as Partial<PluginConfig> | undefined
  return {
    enabled: extra?.enabled === true,
    seedHookUrl: typeof extra?.seedHookUrl === 'string' ? extra.seedHookUrl : undefined,
    apiUrl: typeof extra?.apiUrl === 'string' ? extra.apiUrl : DEFAULT_API_URL,
  }
}
