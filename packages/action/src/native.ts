import type { NativeBuild } from '@tapthrough/protocol'

/** The parts of `eas build:list --json` / `eas build --json` output we use. */
export interface EasBuild {
  id: string
  status: string
  buildProfile?: string | null
  isForIosSimulator?: boolean | null
  app?: { slug?: string; ownerAccount?: { name?: string } } | null
}

/** Runs the EAS CLI with these arguments and returns stdout; throws with stderr on failure. */
export type Eas = (args: string[]) => string

const RUNNING = new Set(['NEW', 'IN_QUEUE', 'IN_PROGRESS'])

/** Where a build's status and Install button are. */
export function buildPageUrl(build: EasBuild): string | null {
  const owner = build.app?.ownerAccount?.name
  const slug = build.app?.slug
  if (!owner || !slug) return null
  return `https://expo.dev/accounts/${encodeURIComponent(owner)}/projects/${encodeURIComponent(slug)}/builds/${encodeURIComponent(build.id)}`
}

function parseBuilds(stdout: string): EasBuild[] {
  // `--json` prints JSON on stdout; anything else went to stderr.
  const start = stdout.indexOf('[')
  if (start < 0) return []
  try {
    const parsed = JSON.parse(stdout.slice(start)) as unknown
    return Array.isArray(parsed) ? (parsed as EasBuild[]) : []
  } catch {
    return []
  }
}

/** A finished build wins; otherwise one that's still going. Errored and canceled ones don't count. */
export function pickBuild(builds: EasBuild[]): EasBuild | null {
  return (
    builds.find((b) => b.status === 'FINISHED') ?? builds.find((b) => RUNNING.has(b.status)) ?? null
  )
}

function toEntry(build: EasBuild, profile: string): NativeBuild['builds'][number] | null {
  const url = buildPageUrl(build)
  if (!url) return null
  return {
    id: build.id,
    profile: build.buildProfile ?? profile,
    url,
    simulator: Boolean(build.isForIosSimulator),
    status: build.status,
  }
}

/** EAS's progress notes, never the reason a build failed. */
const EAS_INFO =
  /^(Distribution Certificate is not validated|Resolved ".*" environment|Learn more|Environment variables|Using remote|Loaded "env"|No environment variables|Build details|Waiting for|✔|- )/i
const EAS_PROBLEM =
  /used its .*builds|error|fail|missing|invalid|cannot|can['’]t|unable|denied|must|expired|\bnot\b|requires?|limit/i
/** EAS's last word on any failure; only shown when there's nothing more specific. */
const EAS_GENERIC = /^Error:\s*(\w+ )?command failed\.?$|^Error:?$/i

/** The line of an EAS error that says what went wrong, without anything that looks like a token. */
export function easError(error: unknown): string {
  const raw =
    (error as { stderr?: Buffer | string })?.stderr?.toString() ||
    (error instanceof Error ? error.message : String(error))
  const lines = raw
    .split('\n')
    .map((l) => l.replace(/\u001b\[[0-9;]*m/g, '').trim())
    .filter((l) => l && !/^(›|»|at\s)/.test(l) && !EAS_INFO.test(l))
  // The first line that names a problem; EAS often prints notes before it.
  const specific = lines.filter((l) => !EAS_GENERIC.test(l))
  const line =
    specific.find((l) => EAS_PROBLEM.test(l)) ?? specific[0] ?? lines[0] ?? 'EAS gave no details.'
  return line.replace(/[A-Za-z0-9_-]{32,}/g, '***').slice(0, 300)
}

/** What to do about the EAS errors teams hit most, after the reason. */
export function easHint(reason: string, platform: 'ios' | 'android', profile: string): string {
  if (/used its .*builds/i.test(reason)) {
    return ` Upgrade the Expo plan, or make this build on a Mac with \`eas build --platform ${platform} --profile ${profile} --local\`.`
  }
  // New devices since the last build: the ad hoc profile needs Apple to re-sign it.
  if (/provisioning profile/i.test(reason)) {
    return ` Run \`eas build --platform ${platform} --profile ${profile}\` once on your computer (it signs in to Apple and updates the profile), then push again.`
  }
  return ''
}

/**
 * Makes sure a development build can run this PR on one platform. For each
 * profile, it looks for a build made for this runtime version; when there's
 * none, the PR changed native code, so it starts one (`--no-wait`: the build
 * runs on EAS while the PR's link explains what's happening).
 */
export function ensureNativeBuild(
  eas: Eas,
  input: { platform: 'ios' | 'android'; runtimeVersion: string; profiles: string[] },
): NativeBuild {
  if (input.profiles.length === 0) return { state: 'off', builds: [] }
  const entries: NativeBuild['builds'] = []
  let started = false
  let building = false
  let skipped = false
  let message: string | undefined
  for (const profile of input.profiles) {
    let existing: EasBuild | null = null
    try {
      existing = pickBuild(
        parseBuilds(
          eas([
            'build:list',
            '--platform',
            input.platform,
            '--runtime-version',
            input.runtimeVersion,
            '--build-profile',
            profile,
            '--limit',
            '10',
            '--json',
            '--non-interactive',
          ]),
        ),
      )
    } catch (error) {
      message = `Couldn’t list builds: ${easError(error)}`
      continue
    }
    if (existing) {
      if (existing.status !== 'FINISHED') building = true
      const entry = toEntry(existing, profile)
      if (entry) entries.push(entry)
      continue
    }
    // Only for a platform and profile the team already builds; never someone's first build.
    let used = false
    try {
      used =
        parseBuilds(
          eas([
            'build:list',
            '--platform',
            input.platform,
            '--build-profile',
            profile,
            '--limit',
            '1',
            '--json',
            '--non-interactive',
          ]),
        ).length > 0
    } catch {
      used = false
    }
    if (!used) {
      skipped = true
      continue
    }
    try {
      const made = parseBuilds(
        eas([
          'build',
          '--profile',
          profile,
          '--platform',
          input.platform,
          '--no-wait',
          '--json',
          '--non-interactive',
        ]),
      )[0]
      if (!made) throw new Error('EAS started no build.')
      started = true
      const entry = toEntry(made, profile)
      if (entry) entries.push(entry)
    } catch (error) {
      const reason = easError(error)
      message = `Couldn’t start a ${profile} build: ${reason}${easHint(reason, input.platform, profile)}`
    }
  }
  const state: NativeBuild['state'] = started
    ? 'started'
    : building
      ? 'building'
      : entries.length > 0
        ? 'found'
        : skipped && !message
          ? 'off'
          : 'failed'
  return { state, builds: entries, ...(message ? { message } : {}) }
}

/** `native-build-profile: development, development-simulator` → the profiles; `off` → none. */
export function parseProfiles(value: string): string[] {
  const trimmed = value.trim()
  if (trimmed === '' || trimmed.toLowerCase() === 'off') return []
  return [
    ...new Set(
      trimmed
        .split(',')
        .map((p) => p.trim())
        .filter((p) => /^[\w.-]+$/.test(p)),
    ),
  ].slice(0, 2)
}
