// @ts-check
/**
 * Expo config plugin. Writes the SDK's build-time settings into `extra.tapthrough`.
 *
 *   plugins: [['@tapthrough/expo', {
 *     // PR previews: launch links, test data, the checklist.
 *     enabled: process.env.APP_VARIANT === 'development',
 *     seedHookUrl: 'https://<ref>.supabase.co/functions/v1/tapthrough-seed',
 *     // Staging and TestFlight builds: report issues and share ideas.
 *     staff: process.env.APP_VARIANT === 'staging',
 *     appKey: process.env.TAPTHROUGH_APP_KEY,
 *   }]]
 *
 * Keep both off for store builds. With `enabled` off the SDK ignores launch
 * links; with `staff` off there's no feedback button outside PR previews.
 *
 * @param {{ expo?: unknown } & Record<string, any>} config
 * @param {{ enabled?: boolean, seedHookUrl?: string, apiUrl?: string, staff?: boolean, appKey?: string }} [props]
 */
function withTapthrough(config, props = {}) {
  const enabled = props.enabled ?? true
  const staff = props.staff === true
  const seedHookUrl = props.seedHookUrl
  const apiUrl = props.apiUrl ?? 'https://tapthrough-cloud.vercel.app'

  if (enabled || staff) {
    if (!isAllowedUrl(apiUrl)) {
      throw new Error(
        `[@tapthrough/expo] \`apiUrl\` must be https (http is allowed only for localhost): ${apiUrl}`,
      )
    }
  }
  if (enabled) {
    // Optional: without it, links open the right screen but can't add test data.
    if (seedHookUrl && !isAllowedUrl(seedHookUrl)) {
      throw new Error(
        `[@tapthrough/expo] \`seedHookUrl\` must be https (http is allowed only for localhost): ${seedHookUrl}`,
      )
    }
    if (!config.scheme) {
      throw new Error(
        '[@tapthrough/expo] Set `scheme` in your app config; launch links open `<scheme>://tapthrough/launch`.',
      )
    }
  }
  if (staff && !props.appKey) {
    throw new Error(
      '[@tapthrough/expo] `staff` needs an `appKey`. Make one with `npx @tapthrough/cli app-key` and pass it from an environment variable.',
    )
  }

  return {
    ...config,
    extra: {
      ...config.extra,
      tapthrough: {
        enabled,
        seedHookUrl: enabled ? seedHookUrl : undefined,
        ...(enabled || staff ? { apiUrl } : {}),
        // The key only goes into builds that use it.
        ...(staff ? { staff, appKey: props.appKey } : {}),
      },
    },
  }
}

/** @param {string} url */
function isAllowedUrl(url) {
  try {
    const { protocol, hostname } = new URL(url)
    if (protocol === 'https:') return true
    // 10.0.2.2 is the host machine from the Android emulator.
    return protocol === 'http:' && ['localhost', '127.0.0.1', '10.0.2.2'].includes(hostname)
  } catch {
    return false
  }
}

module.exports = withTapthrough
