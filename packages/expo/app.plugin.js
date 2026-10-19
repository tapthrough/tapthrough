// @ts-check
/**
 * Expo config plugin. Writes the SDK's build-time settings into `extra.tapthrough`.
 *
 *   plugins: [['@tapthrough/expo', {
 *     enabled: process.env.APP_VARIANT === 'preview',
 *     seedHookUrl: 'https://<ref>.supabase.co/functions/v1/tapthrough-seed',
 *   }]]
 *
 * Keep `enabled` false for store builds: the SDK ignores launch links unless it's on.
 *
 * @param {{ expo?: unknown } & Record<string, any>} config
 * @param {{ enabled?: boolean, seedHookUrl?: string, apiUrl?: string }} [props]
 */
function withTapthrough(config, props = {}) {
  const enabled = props.enabled ?? true
  const seedHookUrl = props.seedHookUrl
  const apiUrl = props.apiUrl ?? 'https://tapthrough.dev'

  if (enabled) {
    if (!seedHookUrl) {
      throw new Error('[@tapthrough/expo] `seedHookUrl` is required when the plugin is enabled.')
    }
    if (!isAllowedUrl(seedHookUrl)) {
      throw new Error(
        `[@tapthrough/expo] \`seedHookUrl\` must be https (http is allowed only for localhost): ${seedHookUrl}`,
      )
    }
    if (!isAllowedUrl(apiUrl)) {
      throw new Error(
        `[@tapthrough/expo] \`apiUrl\` must be https (http is allowed only for localhost): ${apiUrl}`,
      )
    }
    if (!config.scheme) {
      throw new Error(
        '[@tapthrough/expo] Set `scheme` in your app config; launch links open `<scheme>://tapthrough/launch`.',
      )
    }
  }

  return {
    ...config,
    extra: {
      ...config.extra,
      tapthrough: enabled ? { enabled, seedHookUrl, apiUrl } : { enabled, seedHookUrl: undefined },
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
