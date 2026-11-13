export interface TapthroughPluginProps {
  /** Turns the SDK on for this build. Defaults to true; set false for store builds. */
  enabled?: boolean
  /** Your seed hook, e.g. `https://<ref>.supabase.co/functions/v1/tapthrough-seed`. */
  seedHookUrl?: string
  /** Tapthrough's base URL, where in-app reports go. Defaults to `https://tapthrough.dev`. */
  apiUrl?: string
  /**
   * Staging and TestFlight builds: shows a feedback button outside PR previews,
   * to report issues and share ideas. Never turn it on for store builds.
   */
  staff?: boolean
  /** The repo's app key from `npx @tapthrough/cli app-key`; required with `staff`. */
  appKey?: string
}

type ExpoConfig = { scheme?: string | string[]; extra?: Record<string, unknown> } & Record<
  string,
  unknown
>

declare function withTapthrough<T extends ExpoConfig>(
  config: T,
  props?: TapthroughPluginProps,
): T & {
  extra: NonNullable<T['extra']> & {
    tapthrough: {
      enabled: boolean
      seedHookUrl: string | undefined
      apiUrl?: string
      staff?: boolean
      appKey?: string
    }
  }
}

export = withTapthrough
