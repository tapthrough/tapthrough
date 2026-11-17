import { describe, expect, it, vi } from 'vitest'
import { findPreviewUrl, previewHost, probePreview, probeWarning } from './web.js'

const sha = 'a'.repeat(40)

/** A GitHub stub answering deployments, then statuses, from queues. */
function github(deployments: unknown[][], statuses: Record<number, unknown[][]> = {}) {
  return vi.fn(async (path: string) => {
    if (path.includes('/statuses')) {
      const id = Number(/deployments\/(\d+)/.exec(path)?.[1])
      const queue = statuses[id] ?? []
      return queue.length > 1 ? queue.shift() : (queue[0] ?? [])
    }
    return deployments.length > 1 ? deployments.shift() : (deployments[0] ?? [])
  })
}

function clock() {
  let t = 0
  return {
    now: () => t,
    sleep: vi.fn(async (ms: number) => {
      t += ms
    }),
  }
}

const preview = { id: 1, environment: 'Preview – acme-web' }
const ok = { state: 'success', environment_url: 'https://acme-1.vercel.app/', target_url: 'x' }

describe('findPreviewUrl', () => {
  it('waits for the deployment to appear and succeed', async () => {
    const gh = github([[], [preview]], { 1: [[{ state: 'pending' }], [ok]] })
    const { now, sleep } = clock()
    const url = await findPreviewUrl({
      repo: 'acme/web',
      sha,
      timeoutSeconds: 600,
      github: gh,
      now,
      sleep,
    })
    expect(url).toBe('https://acme-1.vercel.app')
    expect(sleep).toHaveBeenCalledTimes(2)
    expect(gh.mock.calls[0]?.[0]).toBe(`/repos/acme/web/deployments?sha=${sha}&per_page=30`)
  })

  it('ignores production deployments of the same commit', async () => {
    const gh = github([[{ id: 9, environment: 'Production – acme-web' }, preview]], { 1: [[ok]] })
    const url = await findPreviewUrl({ repo: 'acme/web', sha, timeoutSeconds: 60, github: gh })
    expect(url).toBe('https://acme-1.vercel.app')
  })

  it('falls back to target_url', async () => {
    const gh = github([[preview]], {
      1: [[{ state: 'success', environment_url: '', target_url: 'https://t.vercel.app' }]],
    })
    expect(await findPreviewUrl({ repo: 'a/b', sha, timeoutSeconds: 60, github: gh })).toBe(
      'https://t.vercel.app',
    )
  })

  it('asks which environment when there are several', async () => {
    const two = [preview, { id: 2, environment: 'Preview – acme-docs' }]
    await expect(
      findPreviewUrl({ repo: 'a/b', sha, timeoutSeconds: 60, github: github([two]) }),
    ).rejects.toThrow('preview-environment')
    const gh = github([two], { 2: [[{ ...ok, environment_url: 'https://docs.vercel.app' }]] })
    expect(
      await findPreviewUrl({
        repo: 'a/b',
        sha,
        timeoutSeconds: 60,
        github: gh,
        environment: 'preview – acme-docs',
      }),
    ).toBe('https://docs.vercel.app')
  })

  it('stops when the deployment failed', async () => {
    const gh = github([[preview]], { 1: [[{ state: 'failure' }]] })
    await expect(
      findPreviewUrl({ repo: 'a/b', sha, timeoutSeconds: 60, github: gh }),
    ).rejects.toThrow('failed')
  })

  it('gives up after the timeout and says what it saw', async () => {
    const { now, sleep } = clock()
    const gh = github([[{ id: 9, environment: 'Production' }]])
    await expect(
      findPreviewUrl({ repo: 'a/b', sha, timeoutSeconds: 30, github: gh, now, sleep }),
    ).rejects.toThrow('after 30s (only found Production)')
    expect(sleep).toHaveBeenCalledTimes(3)
  })
})

describe('previewHost', () => {
  it('returns the host of an https URL', () => {
    expect(previewHost('https://acme-1.vercel.app/')).toBe('acme-1.vercel.app')
    expect(previewHost('http://localhost:3000')).toBe('localhost:3000')
    expect(() => previewHost('http://acme.test')).toThrow('must be https')
    expect(() => previewHost('acme.test')).toThrow("isn't a URL")
  })
})

describe('probePreview', () => {
  const answer = (status: number, headers: Record<string, string> = {}) =>
    (async () => new Response(null, { status, headers })) as unknown as typeof fetch
  const url = 'https://acme-1.vercel.app'

  it('reads what the launch route answers', async () => {
    expect(await probePreview(url, answer(400))).toEqual({ access: 'open', launch: 'ready' })
    expect(await probePreview(url, answer(404))).toEqual({ access: 'open', launch: 'missing' })
    expect(await probePreview(url, answer(401))).toEqual({ access: 'login', launch: 'unknown' })
    expect(await probePreview(url, answer(500))).toEqual({ access: 'open', launch: 'unknown' })
  })

  it('tells a host login from the app redirecting to its own login page', async () => {
    expect(
      await probePreview(url, answer(302, { location: 'https://vercel.com/sso-api?url=x' })),
    ).toEqual({ access: 'login', launch: 'unknown' })
    expect(await probePreview(url, answer(307, { location: '/login' }))).toEqual({
      access: 'open',
      launch: 'missing',
    })
  })

  it('reports test data as off without looking for a launch route problem', async () => {
    expect(await probePreview(url, answer(404), 'off')).toEqual({ access: 'open', launch: 'off' })
    expect(await probePreview(url, answer(401), 'off')).toEqual({ access: 'login', launch: 'off' })
    expect(probeWarning({ access: 'open', launch: 'off' })).toBeNull()
    expect(probeWarning({ access: 'login', launch: 'off' })).toContain('Deployment Protection')
  })

  it('never throws', async () => {
    const down = (async () => {
      throw new Error('ECONNREFUSED')
    }) as unknown as typeof fetch
    expect(await probePreview(url, down)).toEqual({ access: 'unknown', launch: 'unknown' })
  })

  it('warns about what blocks reviewers', () => {
    expect(probeWarning({ access: 'login', launch: 'unknown' })).toContain('Deployment Protection')
    expect(probeWarning({ access: 'open', launch: 'missing' })).toContain('createLaunchRoute')
    expect(probeWarning({ access: 'open', launch: 'ready' })).toBeNull()
    expect(probeWarning({ access: 'unknown', launch: 'unknown' })).toBeNull()
  })
})
