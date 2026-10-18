export interface ExpoInfo {
  projectId: string
  slug: string
  scheme: string
  appId?: string
}

/**
 * Pulls what Tapthrough needs from `expo config --type public --json`: the
 * EAS project (where updates live), the slug (the development build's
 * `exp+<slug>` scheme), the app's own scheme (launch links) and its bundle ID
 * (the link-token audience).
 */
export function expoInfoFromConfig(config: unknown): ExpoInfo {
  const c = (config ?? {}) as {
    slug?: unknown
    scheme?: unknown
    extra?: { eas?: { projectId?: unknown } }
    ios?: { bundleIdentifier?: unknown }
    android?: { package?: unknown }
  }
  const projectId = c.extra?.eas?.projectId
  if (typeof projectId !== 'string') {
    throw new Error('No EAS project ID in the app config. Run `eas init` in the app first.')
  }
  if (typeof c.slug !== 'string') throw new Error('No slug in the app config.')
  const scheme = Array.isArray(c.scheme) ? c.scheme[0] : c.scheme
  if (typeof scheme !== 'string') {
    throw new Error(
      'No scheme in the app config. Set `scheme`; Tapthrough links open `<scheme>://`.',
    )
  }
  const appId = [c.ios?.bundleIdentifier, c.android?.package].find(
    (v): v is string => typeof v === 'string',
  )
  return { projectId, slug: c.slug, scheme, ...(appId ? { appId } : {}) }
}
