export interface TapthroughPluginProps {
  /** Turns the SDK on for this build. Defaults to true; set false for store builds. */
  enabled?: boolean
  /** Your seed hook, e.g. `https://<ref>.supabase.co/functions/v1/tapthrough-seed`. */
  seedHookUrl?: string
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
    tapthrough: { enabled: boolean; seedHookUrl: string | undefined }
  }
}

export = withTapthrough
