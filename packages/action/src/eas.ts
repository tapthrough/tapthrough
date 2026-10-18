import type { Platform } from '@tapthrough/protocol'

export interface PlatformUpdate {
  platform: Platform
  updateGroupId: string
  runtimeVersion: string
}

/**
 * Reads the output of `eas update --json`: one entry per platform, each with
 * its update group and runtime version. Fails loudly on anything else, since a
 * wrong group ID means reviewers open the wrong code.
 */
export function parseEasUpdateJson(text: string): PlatformUpdate[] {
  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    throw new Error(
      'The update JSON is not valid JSON. Run `eas update` with --json and --non-interactive.',
    )
  }
  if (!Array.isArray(json) || json.length === 0) {
    throw new Error('The update JSON has no updates. Did `eas update` publish anything?')
  }

  const byPlatform = new Map<Platform, PlatformUpdate>()
  for (const entry of json) {
    const { platform, group, runtimeVersion } = (entry ?? {}) as Record<string, unknown>
    if (platform !== 'ios' && platform !== 'android') continue
    if (typeof group !== 'string' || typeof runtimeVersion !== 'string') {
      throw new Error(`The ${platform} update is missing its group or runtimeVersion.`)
    }
    byPlatform.set(platform, { platform, updateGroupId: group, runtimeVersion })
  }
  if (byPlatform.size === 0) throw new Error('The update JSON has no iOS or Android updates.')
  return (['ios', 'android'] as const).flatMap((p) => byPlatform.get(p) ?? [])
}
