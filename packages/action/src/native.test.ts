import { describe, expect, it } from 'vitest'
import {
  buildPageUrl,
  easError,
  easHint,
  ensureNativeBuild,
  parseProfiles,
  pickBuild,
} from './native.js'

const app = { slug: 'notes', ownerAccount: { name: 'acme' } }
const build = (id: string, status: string, extra = {}) => ({
  id,
  status,
  app,
  buildProfile: 'development',
  ...extra,
})

function fakeEas(lists: Record<string, unknown[]>, started?: unknown[], used = true) {
  const calls: string[][] = []
  const eas = (args: string[]) => {
    calls.push(args)
    if (args[0] === 'build:list') {
      // Without --runtime-version: any build of this profile, i.e. does the team use it?
      if (!args.includes('--runtime-version')) {
        return JSON.stringify(used ? [build('old', 'FINISHED')] : [])
      }
      return JSON.stringify(lists[args[args.indexOf('--build-profile') + 1] as string] ?? [])
    }
    if (args[0] === 'build') {
      if (!started)
        throw Object.assign(new Error('fail'), {
          stderr: 'Distribution certificate is missing\n  at x',
        })
      return `Building…\n${JSON.stringify(started)}`
    }
    throw new Error(`unexpected ${args[0]}`)
  }
  return { eas, calls }
}

describe('native builds for a PR', () => {
  it('uses an existing build for the runtime and starts nothing', () => {
    const { eas, calls } = fakeEas({ development: [build('b1', 'FINISHED')] })
    const result = ensureNativeBuild(eas, {
      platform: 'ios',
      runtimeVersion: 'rv1',
      profiles: ['development'],
    })
    expect(result).toEqual({
      state: 'found',
      builds: [
        {
          id: 'b1',
          profile: 'development',
          url: 'https://expo.dev/accounts/acme/projects/notes/builds/b1',
          simulator: false,
          status: 'FINISHED',
        },
      ],
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toEqual(
      expect.arrayContaining(['--runtime-version', 'rv1', '--build-profile', 'development']),
    )
  })

  it('waits on a build that is still going instead of starting another', () => {
    const { eas, calls } = fakeEas({
      development: [build('b0', 'ERRORED'), build('b2', 'IN_QUEUE')],
    })
    expect(
      ensureNativeBuild(eas, { platform: 'ios', runtimeVersion: 'rv', profiles: ['development'] })
        .state,
    ).toBe('building')
    expect(calls).toHaveLength(1)
  })

  it('starts a build when the PR changed native code', () => {
    const { eas, calls } = fakeEas({}, [build('new1', 'NEW', { isForIosSimulator: true })])
    const result = ensureNativeBuild(eas, {
      platform: 'ios',
      runtimeVersion: 'rv',
      profiles: ['development'],
    })
    expect(result.state).toBe('started')
    expect(result.builds[0]).toMatchObject({ id: 'new1', simulator: true })
    expect(calls[2]).toEqual([
      'build',
      '--profile',
      'development',
      '--platform',
      'ios',
      '--no-wait',
      '--json',
      '--non-interactive',
    ])
  })

  it('reports why when it can’t start one', () => {
    const { eas } = fakeEas({})
    const result = ensureNativeBuild(eas, {
      platform: 'ios',
      runtimeVersion: 'rv',
      profiles: ['development'],
    })
    expect(result).toMatchObject({
      state: 'failed',
      message: 'Couldn’t start a development build: Distribution certificate is missing',
    })
  })

  it('never starts a team’s first build for a platform', () => {
    const { eas, calls } = fakeEas({}, [build('new1', 'NEW')], false)
    expect(
      ensureNativeBuild(eas, {
        platform: 'android',
        runtimeVersion: 'rv',
        profiles: ['development'],
      }),
    ).toEqual({ state: 'off', builds: [] })
    expect(calls.some((c) => c[0] === 'build')).toBe(false)
  })

  it('does nothing when turned off', () => {
    const { eas, calls } = fakeEas({})
    expect(
      ensureNativeBuild(eas, { platform: 'android', runtimeVersion: 'rv', profiles: [] }),
    ).toEqual({ state: 'off', builds: [] })
    expect(calls).toHaveLength(0)
  })

  it('parses profiles and picks builds', () => {
    expect(parseProfiles('development, development-simulator, extra')).toEqual([
      'development',
      'development-simulator',
    ])
    expect(parseProfiles('off')).toEqual([])
    expect(parseProfiles('dev; rm -rf')).toEqual([])
    expect(
      pickBuild([build('a', 'CANCELED'), build('b', 'IN_PROGRESS'), build('c', 'FINISHED')])?.id,
    ).toBe('c')
    expect(buildPageUrl({ id: 'x', status: 'NEW' })).toBeNull()
    expect(easError(new Error('token ghs_abcdefghijklmnopqrstuvwxyz0123456789 bad'))).toBe(
      'token *** bad',
    )
    // EAS prints notes (and a certificate warning) first; the reason comes later.
    const quota =
      'This account has used its iOS builds from the Free plan this month, which will reset in 16 days (on Tue Dec 01 2026). Upgrade your plan for more builds.'
    expect(
      easError({
        stderr: [
          'Resolved "development" environment for the build. Learn more: https://docs.expo.dev/eas/environment-variables/#environments',
          '\u001b[33mDistribution Certificate is not validated for non-interactive builds.\u001b[39m',
          'All credentials are ready to build @acme/app (com.acme.app)',
          quota,
          '    Error: build command failed.',
        ].join('\n'),
      }),
    ).toBe(quota)
    expect(easHint(quota, 'ios', 'development')).toContain('--local')
    expect(easHint('Something else', 'ios', 'development')).toBe('')
  })
})
