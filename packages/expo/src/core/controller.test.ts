import type { SeedHookResponse } from '@tapthrough/protocol'
import { describe, expect, it, vi } from 'vitest'
import { type ControllerDeps, createLaunchController, type LaunchState } from './controller.js'

const seeded: SeedHookResponse = {
  apiVersion: 1,
  session: { access_token: 'at', refresh_token: 'rt' },
  refs: {},
  route: { path: '/notes', params: {} },
  flags: {},
}

const url = (token: string) => `acme://tapthrough/launch?t=${token}`

function deps(overrides: Partial<ControllerDeps> = {}): ControllerDeps {
  return {
    seedHookUrl: 'https://hook.test/seed',
    fetch: vi.fn(async () => Response.json(seeded)),
    auth: { signIn: vi.fn(async () => {}) },
    ...overrides,
  }
}

/** Resolves once the controller reaches a state matching `status`. */
function waitFor(controller: ReturnType<typeof createLaunchController>, status: string) {
  return new Promise<LaunchState>((resolve) => {
    const check = () => {
      const state = controller.getState()
      if (state.status === status) {
        unsubscribe()
        resolve(state)
      }
    }
    const unsubscribe = controller.subscribe(check)
    check()
  })
}

describe('createLaunchController', () => {
  it('ignores URLs that are not launch links', () => {
    const controller = createLaunchController()
    expect(controller.offer('acme://notes/1')).toBe(false)
    expect(controller.offer(null)).toBe(false)
    expect(controller.getState()).toEqual({ status: 'idle' })
  })

  it('waits for configure and the navigator before launching', async () => {
    const controller = createLaunchController()
    const navigate = vi.fn()

    // Expo Router hands over the initial URL before the root layout mounts.
    expect(controller.offer(url('a'))).toBe(true)
    await Promise.resolve()
    expect(controller.getState()).toEqual({ status: 'idle' })

    const d = deps()
    controller.configure(d)
    await waitFor(controller, 'launching')
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(d.auth.signIn).toHaveBeenCalledOnce()
    expect(navigate).not.toHaveBeenCalled()

    controller.setNavigator(navigate)
    expect(await waitFor(controller, 'done')).toEqual({ status: 'done', path: '/notes' })
    expect(navigate).toHaveBeenCalledWith('/notes')
  })

  it('runs each token once, even when native intent and Linking both deliver it', async () => {
    const controller = createLaunchController()
    const d = deps()
    controller.configure(d)
    controller.setNavigator(() => {})

    expect(controller.offer(url('same'))).toBe(true)
    expect(controller.offer(url('same'))).toBe(false)
    await waitFor(controller, 'done')
    expect(d.fetch).toHaveBeenCalledOnce()
  })

  it('runs launches one at a time, in order', async () => {
    const controller = createLaunchController()
    const order: string[] = []
    controller.configure(
      deps({
        fetch: vi.fn(async (_url, init) => {
          const { token } = JSON.parse(String(init?.body)) as { token: string }
          order.push(`start:${token}`)
          await new Promise((resolve) => setTimeout(resolve, 5))
          order.push(`end:${token}`)
          return Response.json(seeded)
        }),
      }),
    )
    controller.setNavigator(() => {})

    controller.offer(url('first'))
    controller.offer(url('second'))
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(order).toEqual(['start:first', 'end:first', 'start:second', 'end:second'])
  })

  it('exposes errors until dismissed', async () => {
    const controller = createLaunchController()
    controller.configure(
      deps({
        fetch: vi.fn(async () =>
          Response.json(
            { error: { code: 'expired', message: 'This link has expired.' } },
            {
              status: 401,
            },
          ),
        ),
      }),
    )
    controller.offer(url('old'))
    expect(await waitFor(controller, 'error')).toEqual({
      status: 'error',
      error: { code: 'expired', message: 'This link has expired.' },
    })
    controller.dismiss()
    expect(controller.getState()).toEqual({ status: 'idle' })
  })

  it('notifies subscribers and stops after unsubscribe', async () => {
    const controller = createLaunchController()
    const listener = vi.fn()
    const unsubscribe = controller.subscribe(listener)
    controller.configure(deps())
    controller.setNavigator(() => {})
    controller.offer(url('x'))
    await waitFor(controller, 'done')
    const calls = listener.mock.calls.length
    expect(calls).toBeGreaterThanOrEqual(2)

    unsubscribe()
    controller.dismiss()
    expect(listener).toHaveBeenCalledTimes(calls)
  })
})
