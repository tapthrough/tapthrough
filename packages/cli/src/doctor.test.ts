import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  checkLatest,
  type DoctorCheck,
  doctorExitCode,
  formatDoctor,
  liveChecks,
  liveTarget,
  runDoctor,
  withLiveChecks,
} from './doctor.js'
import { resolvedVersions } from './doctor-lockfile.js'
import { readWorkflow } from './doctor-workflow.js'
import type { Project } from './project.js'
import { detectFramework, frameworkRoutes } from './routes.js'

/** A project made of in-memory files. Paths are relative to the repo root. */
function project(files: Record<string, string>, appRoot = ''): Project {
  const inApp = (relative: string) => path.posix.normalize(path.posix.join(appRoot, relative))
  const names = Object.keys(files)
  const appDir =
    ['src/app', 'app'].map(inApp).find((dir) => names.some((n) => n.startsWith(`${dir}/`))) ?? null
  const framework = detectFramework(files[inApp('package.json')] ?? null) ?? 'expo-router'
  return {
    root: '/repo',
    appRoot,
    framework,
    appDir,
    routes: appDir ? frameworkRoutes(framework, appDir, names) : [],
    shells: [],
    sources: new Map(
      names.filter((n) => /\.(tsx?|jsx?|mjs|cjs)$/.test(n)).map((n) => [n, files[n] ?? '']),
    ),
    aliases: [],
    read: (relative) => files[inApp(relative)] ?? null,
    list: (relative) => {
      const dir = `${inApp(relative)}/`
      return names
        .filter((n) => n.startsWith(dir) && !n.slice(dir.length).includes('/'))
        .map((n) => n.slice(dir.length))
        .sort()
    },
  }
}

const WEB_WORKFLOW = `name: Tapthrough preview

on:
  pull_request:

permissions:
  contents: read
  id-token: write # proves which repo this is
  deployments: read

jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: tapthrough/tapthrough@main
        with:
          platform: web
          app-id: app.acme.com
          test-data: "off"
`

const WEB_LAYOUT = `import { Tapthrough } from '@tapthrough/next/panel'
export default function RootLayout({ children }) {
  return (<html><body>{children}<Tapthrough appId="app.acme.com" /></body></html>)
}`

const LAUNCH_ROUTE = `import { createLaunchRoute } from '@tapthrough/next'
import { seedHandler } from '@/lib/tapthrough/seed'
export const GET = createLaunchRoute({ appId: 'app.acme.com', seed: seedHandler })`

function scenario(routePath: string, preset?: string) {
  return JSON.stringify({
    title: 'A scenario',
    route: { path: routePath },
    seed: preset ? { tier: 2, preset } : { tier: 0 },
  })
}

function webApp(overrides: Record<string, string | undefined> = {}) {
  const files: Record<string, string | undefined> = {
    'package.json': JSON.stringify({
      dependencies: { next: '15.0.0', '@tapthrough/next': '^0.1.2' },
    }),
    'package-lock.json': JSON.stringify({
      packages: {
        'node_modules/@tapthrough/next': { version: '0.1.2' },
        'node_modules/@tapthrough/core': { version: '0.3.0' },
      },
    }),
    'app/layout.tsx': WEB_LAYOUT,
    'app/page.tsx': '',
    'app/pricing/page.tsx': '',
    '.github/workflows/tapthrough.yml': WEB_WORKFLOW,
    '.tapthrough/scenarios/pricing.json': scenario('/pricing'),
    ...overrides,
  }
  return project(
    Object.fromEntries(
      Object.entries(files).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  )
}

const EXPO_WORKFLOW = `name: Tapthrough preview
on:
  pull_request:
    types: [opened, synchronize, reopened]
permissions:
  contents: read
  id-token: write
jobs:
  preview:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - name: Comment
        uses: tapthrough/tapthrough@main
        with:
          update-json: eas-update.json
          api-url: https://tapthrough-cloud.vercel.app
`

function expoApp(overrides: Record<string, string | undefined> = {}) {
  const files: Record<string, string | undefined> = {
    'package.json': JSON.stringify({
      dependencies: { expo: '~54.0.0', 'expo-router': '~6.0.0', '@tapthrough/expo': '^0.1.13' },
    }),
    'app.config.ts': `export default { scheme: 'acme', plugins: [['@tapthrough/expo', {
      enabled: process.env.APP_VARIANT !== 'production',
      seedHookUrl: 'https://ref.supabase.co/functions/v1/tapthrough-seed',
    }]] }`,
    'app/_layout.tsx': `import { Tapthrough } from '@tapthrough/expo'
export default function RootLayout() { return <Tapthrough auth={auth}><Stack /></Tapthrough> }`,
    'app/index.tsx': '',
    '.github/workflows/tapthrough.yml': EXPO_WORKFLOW,
    '.tapthrough/scenarios/home.json': scenario('/'),
    ...overrides,
  }
  return project(
    Object.fromEntries(
      Object.entries(files).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  )
}

function byId(checks: DoctorCheck[]) {
  return Object.fromEntries(checks.map((check) => [check.id, check]))
}

function statuses(checks: DoctorCheck[]) {
  return Object.fromEntries(checks.map((check) => [check.id, check.status]))
}

describe('runDoctor on a Next.js app', () => {
  it('passes a correct setup without test data', () => {
    const report = runDoctor(webApp())
    expect(report.framework).toBe('next-app')
    expect(report.testData).toBe('off')
    expect(statuses(report.checks)).toEqual({
      app: 'pass',
      sdk: 'pass',
      'sdk-versions': 'pass',
      'web-panel': 'pass',
      'web-launch-route': 'pass',
      'app-id': 'pass',
      workflow: 'pass',
      'workflow-branches': 'pass',
      scenarios: 'pass',
    })
    expect(byId(report.checks).workflow?.message).toBe(
      '.github/workflows/tapthrough.yml uses the Tapthrough action (platform web, app-id app.acme.com, test-data off).',
    )
    expect(report.summary).toEqual({ pass: 9, warn: 0, fail: 0 })
    expect(doctorExitCode(report)).toBe(0)
    expect(report.note).toMatch(/can't see which database/)
  })

  it('fails when test data is on and there is no launch route', () => {
    const on = WEB_WORKFLOW.replace('          test-data: "off"\n', '')
    const report = runDoctor(webApp({ '.github/workflows/tapthrough.yml': on }))
    expect(report.testData).toBe('on')
    expect(byId(report.checks)['web-launch-route']).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('no launch route at app/api/tapthrough/launch/route.ts'),
    })
    expect(doctorExitCode(report)).toBe(1)

    const fixed = runDoctor(
      webApp({
        '.github/workflows/tapthrough.yml': on,
        'app/api/tapthrough/launch/route.ts': LAUNCH_ROUTE,
      }),
    )
    expect(statuses(fixed.checks)['web-launch-route']).toBe('pass')
  })

  it('fails when the layout has no <Tapthrough>, and warns when it is rendered elsewhere', () => {
    const bare = 'export default function RootLayout({ children }) { return children }'
    expect(byId(runDoctor(webApp({ 'app/layout.tsx': bare })).checks)['web-panel']?.status).toBe(
      'fail',
    )

    const commented = WEB_LAYOUT.replace(
      '<Tapthrough appId="app.acme.com" />',
      '{/* <Tapthrough appId="x" /> */}',
    )
    expect(
      byId(runDoctor(webApp({ 'app/layout.tsx': commented })).checks)['web-panel']?.status,
    ).toBe('fail')

    const elsewhere = runDoctor(
      webApp({
        'app/layout.tsx': bare,
        'components/shell.tsx':
          'import { Tapthrough } from \'@tapthrough/next/panel\'\nexport const Shell = () => <Tapthrough appId="app.acme.com" />',
      }),
    )
    expect(byId(elsewhere.checks)['web-panel']).toMatchObject({
      status: 'warn',
      message: expect.stringMatching(
        /^Couldn't tell: <Tapthrough> is rendered in components\/shell.tsx/,
      ),
    })
  })

  it('fails when the app ID differs between the layout and the workflow', () => {
    const report = runDoctor(
      webApp({ 'app/layout.tsx': WEB_LAYOUT.replace('app.acme.com', 'acme.com') }),
    )
    expect(byId(report.checks)['app-id']).toMatchObject({
      status: 'fail',
      message: expect.stringContaining(
        'acme.com in app/layout.tsx, app.acme.com in .github/workflows/tapthrough.yml',
      ),
    })
  })

  it('finds the layout under src/app and the workflow at the repo root of a monorepo', () => {
    const files: Record<string, string> = {
      'apps/web/package.json': JSON.stringify({
        dependencies: { next: '15', '@tapthrough/next': '^0.1.2' },
      }),
      'apps/web/src/app/layout.tsx': WEB_LAYOUT,
      'apps/web/src/app/page.tsx': '',
      'pnpm-lock.yaml':
        "packages:\n\n  '@tapthrough/next@0.1.2(react@19.0.0)':\n    resolution: {integrity: sha512-x}\n",
      '.github/workflows/tapthrough.yml': WEB_WORKFLOW,
    }
    const report = runDoctor(project(files, 'apps/web'))
    expect(statuses(report.checks)).toMatchObject({
      'web-panel': 'pass',
      'sdk-versions': 'pass',
      workflow: 'pass',
      scenarios: 'warn',
    })
    expect(byId(report.checks)['sdk-versions']?.message).toBe(
      'pnpm-lock.yaml resolves @tapthrough/next 0.1.2.',
    )
  })

  it('fails when the SDK is missing and warns without a lockfile', () => {
    const report = runDoctor(
      webApp({
        'package.json': JSON.stringify({ dependencies: { next: '15.0.0' } }),
        'package-lock.json': undefined,
      }),
    )
    expect(byId(report.checks).sdk).toEqual({
      id: 'sdk',
      status: 'fail',
      message: "@tapthrough/next isn't in package.json. Run `npm install @tapthrough/next`.",
    })
    expect(byId(report.checks)['sdk-versions']?.status).toBe('warn')
  })

  it('warns when one package resolves to two versions', () => {
    const lock = JSON.stringify({
      packages: {
        'node_modules/@tapthrough/next': { version: '0.1.2' },
        'node_modules/@tapthrough/protocol': { version: '0.3.0' },
        'node_modules/@tapthrough/next/node_modules/@tapthrough/protocol': { version: '0.2.0' },
      },
    })
    const check = byId(runDoctor(webApp({ 'package-lock.json': lock })).checks)['sdk-versions']
    expect(check).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('resolves @tapthrough/protocol to more than one version'),
      details: ['@tapthrough/next 0.1.2', '@tapthrough/protocol 0.2.0 and 0.3.0'],
    })
  })
})

describe('runDoctor on the workflow', () => {
  it('fails when no workflow uses the action', () => {
    const report = runDoctor(webApp({ '.github/workflows/tapthrough.yml': undefined }))
    expect(byId(report.checks).workflow?.status).toBe('fail')
    expect(report.testData).toBeUndefined()
    expect(byId(report.checks)['web-launch-route']?.status).toBe('warn')
  })

  it('warns when only some base branches trigger it', () => {
    const limited = WEB_WORKFLOW.replace(
      '  pull_request:\n',
      '  pull_request:\n    branches: [main, "release/*"]\n',
    )
    expect(
      byId(runDoctor(webApp({ '.github/workflows/tapthrough.yml': limited })).checks)[
        'workflow-branches'
      ],
    ).toEqual({
      id: 'workflow-branches',
      status: 'warn',
      message:
        '.github/workflows/tapthrough.yml runs only for pull requests into main, release/*. Other PRs get no Tapthrough comment. Remove `branches` under `on.pull_request` to cover them all.',
    })
  })

  it('fails without id-token: write, without app-id, and when it never runs on pull requests', () => {
    const broken = WEB_WORKFLOW.replace('  id-token: write # proves which repo this is\n', '')
      .replace('          app-id: app.acme.com\n', '')
      .replace('on:\n  pull_request:\n', 'on:\n  push:\n    branches: [main]\n')
    const checks = byId(runDoctor(webApp({ '.github/workflows/tapthrough.yml': broken })).checks)
    expect(checks.workflow?.status).toBe('fail')
    expect(checks.workflow?.message).toContain('id-token: write')
    expect(checks.workflow?.message).toContain('Web needs `app-id`')
    expect(checks['workflow-branches']?.status).toBe('fail')
  })

  it('fails when the platform input is for the other kind of app', () => {
    const wrong = WEB_WORKFLOW.replace('platform: web', 'platform: expo')
    expect(
      byId(runDoctor(webApp({ '.github/workflows/tapthrough.yml': wrong })).checks).workflow,
    ).toMatchObject({
      status: 'fail',
      message: expect.stringContaining("`platform: expo` doesn't match this Next.js app"),
    })
  })
})

describe('readWorkflow', () => {
  const uses = '\njobs:\n  a:\n    steps:\n      - uses: tapthrough/tapthrough@v1\n'

  it('reads every way of writing the pull_request trigger', () => {
    const trigger = (on: string) => readWorkflow(`${on}${uses}`).trigger
    expect(trigger('on: pull_request')).toEqual({ kind: 'all' })
    expect(trigger('on: [push, pull_request]')).toEqual({ kind: 'all' })
    expect(trigger('on:\n  - push\n  - pull_request')).toEqual({ kind: 'all' })
    expect(trigger('"on":\n  pull_request:\n    types: [opened]')).toEqual({ kind: 'all' })
    expect(trigger('on: push')).toEqual({ kind: 'none' })
    expect(trigger('on:\n  push:\n    branches: [main]')).toEqual({ kind: 'none' })
    expect(
      trigger('on:\n  pull_request:\n    branches:\n      - main # default\n      - develop'),
    ).toEqual({
      kind: 'limited',
      branches: ['main', 'develop'],
    })
    expect(trigger('on:\n  pull_request:\n    branches:\n    - main')).toEqual({
      kind: 'limited',
      branches: ['main'],
    })
    expect(
      trigger(
        "on:\n  pull_request_target:\n    branches-ignore: ['legacy/**']\n    paths:\n      - 'apps/web/**'",
      ),
    ).toEqual({ kind: 'limited', branchesIgnore: ['legacy/**'], paths: ['apps/web/**'] })
  })

  it("says unknown rather than guess at forms it doesn't read", () => {
    expect(readWorkflow(`on: { pull_request: { branches: [main] } }${uses}`).trigger).toEqual({
      kind: 'unknown',
    })
    expect(readWorkflow(`name: x${uses}`).trigger).toEqual({ kind: 'unknown' })
    expect(
      readWorkflow(
        'on: pull_request\njobs:\n  a:\n    steps:\n      - uses: tapthrough/tapthrough@v1\n        with: { app-id: "$' +
          '{{ vars.APP_ID }}", platform: web }\n',
      ).inputs,
    ).toBeNull()
  })

  it('reads inputs in block and inline form, with quotes and comments', () => {
    expect(readWorkflow(WEB_WORKFLOW)).toMatchObject({
      inputs: { platform: 'web', 'app-id': 'app.acme.com', 'test-data': 'off' },
      idToken: true,
    })
    expect(readWorkflow(EXPO_WORKFLOW).inputs).toEqual({
      'update-json': 'eas-update.json',
      'api-url': 'https://tapthrough-cloud.vercel.app',
    })
    expect(
      readWorkflow(
        "on: pull_request\njobs:\n  a:\n    steps:\n      - uses: tapthrough/tapthrough@v1\n        with: { platform: web, app-id: 'a.b' } # inline\n      - run: echo\n        with:\n          platform: expo\n",
      ).inputs,
    ).toEqual({ platform: 'web', 'app-id': 'a.b' })
    expect(readWorkflow(`on: pull_request${uses}`).inputs).toEqual({})
    expect(
      readWorkflow(
        'on: pull_request\njobs:\n  a:\n    steps:\n      # - uses: tapthrough/tapthrough@v1\n',
      ).inputs,
    ).toBeNull()
  })
})

describe('resolvedVersions', () => {
  it('reads pnpm lockfiles, old and new', () => {
    const text = `lockfileVersion: '9.0'
importers:
  .:
    dependencies:
      '@tapthrough/expo':
        specifier: ^0.1.12
        version: 0.1.13(expo@54.0.0)
packages:

  '@tapthrough/expo@0.1.13':
    resolution: {integrity: sha512-a}

  /@tapthrough/protocol/0.2.0:
    resolution: {integrity: sha512-b}

  '@tapthrough/protocol@0.3.0-beta.1':
    resolution: {integrity: sha512-c}

snapshots:

  '@tapthrough/expo@0.1.13(expo@54.0.0)':
    dependencies:
      '@tapthrough/protocol': 0.3.0-beta.1
`
    expect([...(resolvedVersions('pnpm-lock.yaml', text) ?? [])]).toEqual([
      ['@tapthrough/expo', ['0.1.13']],
      ['@tapthrough/protocol', ['0.2.0', '0.3.0-beta.1']],
    ])
  })

  it('reads yarn lockfiles', () => {
    const text = `# yarn lockfile v1

"@tapthrough/core@^0.3.0", "@tapthrough/core@~0.3.0":
  version "0.3.1"
  resolved "https://registry.yarnpkg.com/x.tgz"

"@tapthrough/expo@^0.1.12":
  version "0.1.12"
  dependencies:
    "@tapthrough/core" "^0.3.0"

react@19:
  version "19.0.0"
`
    expect([...(resolvedVersions('yarn.lock', text) ?? [])]).toEqual([
      ['@tapthrough/core', ['0.3.1']],
      ['@tapthrough/expo', ['0.1.12']],
    ])
  })

  it('reads npm lockfiles, and says so when one is broken', () => {
    const v1 = JSON.stringify({
      dependencies: {
        '@tapthrough/next': {
          version: '0.1.2',
          dependencies: { '@tapthrough/core': { version: '0.2.9' } },
        },
        '@tapthrough/core': { version: '0.3.0' },
      },
    })
    expect([...(resolvedVersions('package-lock.json', v1) ?? [])]).toEqual([
      ['@tapthrough/core', ['0.2.9', '0.3.0']],
      ['@tapthrough/next', ['0.1.2']],
    ])
    expect(resolvedVersions('package-lock.json', '{ nope')).toBeNull()
  })
})

describe('runDoctor on an Expo app', () => {
  it('passes a correct setup', () => {
    const report = runDoctor(expoApp())
    expect(report.framework).toBe('expo-router')
    expect(statuses(report.checks)).toEqual({
      app: 'pass',
      sdk: 'pass',
      'sdk-versions': 'warn',
      'mobile-plugin': 'pass',
      'mobile-wrapper': 'pass',
      'mobile-seed-hook': 'pass',
      workflow: 'pass',
      'workflow-branches': 'pass',
      scenarios: 'pass',
    })
  })

  it('does not count a commented-out seedHookUrl', () => {
    const config = `export default { plugins: [['@tapthrough/expo', {
      enabled: process.env.APP_VARIANT !== 'production',
      apiUrl: 'https://tapthrough-cloud.vercel.app',
      // seedHookUrl: 'https://<your-staging>/functions/v1/tapthrough-seed',
    }]] }`
    const checks = byId(runDoctor(expoApp({ 'app.config.ts': config })).checks)
    expect(checks['mobile-plugin']?.status).toBe('pass')
    expect(checks['mobile-seed-hook']).toMatchObject({
      status: 'warn',
      message: expect.stringContaining("`seedHookUrl` isn't set"),
    })
  })

  it("says it couldn't tell when a JS config doesn't name the plugin", () => {
    const checks = byId(
      runDoctor(
        expoApp({
          'app.config.ts': "import { plugins } from './plugins'\nexport default { plugins }",
        }),
      ).checks,
    )
    expect(checks['mobile-plugin']).toMatchObject({
      status: 'warn',
      message: expect.stringMatching(/^Couldn't tell/),
    })
    expect(checks['mobile-seed-hook']).toMatchObject({
      status: 'warn',
      message: expect.stringMatching(/^Couldn't tell/),
    })
  })

  it('reads app.json, and warns that it leaves the SDK on in every build', () => {
    const appJson = (plugins: unknown[]) => JSON.stringify({ expo: { scheme: 'acme', plugins } })
    const on = runDoctor(
      expoApp({
        'app.config.ts': undefined,
        'app.json': appJson([
          'expo-router',
          ['@tapthrough/expo', { seedHookUrl: 'https://hook.test/seed' }],
        ]),
      }),
    )
    expect(byId(on.checks)['mobile-plugin']).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('on in every build'),
    })
    expect(byId(on.checks)['mobile-seed-hook']?.status).toBe('pass')

    const missing = runDoctor(
      expoApp({ 'app.config.ts': undefined, 'app.json': appJson(['expo-router']) }),
    )
    expect(byId(missing.checks)['mobile-plugin']?.status).toBe('fail')
  })

  it('fails when the root layout does not use <Tapthrough>, and when update-json is missing', () => {
    const checks = byId(
      runDoctor(
        expoApp({
          'app/_layout.tsx': 'export default function RootLayout() { return <Stack /> }',
          '.github/workflows/tapthrough.yml': EXPO_WORKFLOW.replace(
            '          update-json: eas-update.json\n',
            '',
          ),
        }),
      ).checks,
    )
    expect(checks['mobile-wrapper']?.status).toBe('fail')
    expect(checks.workflow).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('Expo needs `update-json`'),
    })
  })
})

describe('runDoctor on scenarios', () => {
  it('summarises what `check` finds', () => {
    const report = runDoctor(
      webApp({
        '.tapthrough/scenarios/gone.json': scenario('/gone'),
        '.tapthrough/scenarios/broken.json': '{ nope',
      }),
    )
    expect(byId(report.checks).scenarios).toEqual({
      id: 'scenarios',
      status: 'fail',
      message:
        '2 scenarios, 2 problems. The service skips broken files; fix them, then run `tapthrough check`.',
      details: [
        '.tapthrough/scenarios/broken.json: not valid JSON',
        '.tapthrough/scenarios/gone.json: route "/gone" isn\'t a screen in the app. Run `npx @tapthrough/cli map` to list the screens.',
      ],
    })
  })

  it('warns about presets that no source file names', () => {
    const files = {
      '.tapthrough/scenarios/a.json': scenario('/pricing', 'owner-with-project'),
      '.tapthrough/scenarios/b.json': scenario('/', 'emptyAccount'),
      '.tapthrough/scenarios/c.json': scenario('/', 'missing-one'),
      'lib/tapthrough/presets.ts':
        "import { definePreset } from '@tapthrough/seed'\nexport const presets = { 'owner-with-project': definePreset({}), emptyAccount: definePreset({}) }",
    }
    expect(byId(runDoctor(webApp(files)).checks)['scenario-presets']).toMatchObject({
      status: 'warn',
      message: expect.stringContaining('1 preset that no source file names: missing-one.'),
    })
    expect(
      byId(runDoctor(webApp({ ...files, '.tapthrough/scenarios/c.json': undefined })).checks)[
        'scenario-presets'
      ]?.status,
    ).toBe('pass')
    expect(
      byId(runDoctor(webApp({ ...files, 'lib/tapthrough/presets.ts': undefined })).checks)[
        'scenario-presets'
      ],
    ).toMatchObject({ status: 'warn', message: expect.stringMatching(/^Couldn't tell/) })
  })
})

describe('runDoctor outside an app', () => {
  it('fails clearly and stops', () => {
    const report = runDoctor(
      project({ 'package.json': JSON.stringify({ dependencies: { vite: '6' } }) }),
    )
    expect(report.framework).toBeNull()
    expect(report.checks).toEqual([
      {
        id: 'app',
        status: 'fail',
        message:
          "This isn't an Expo or Next.js app: package.json lists neither `expo` nor `next`. Run the doctor in the app's directory, or pass --dir.",
      },
    ])
    expect(doctorExitCode(report)).toBe(1)
  })
})

describe('formatDoctor', () => {
  it('prints one line per check, details under it, the totals and the note', () => {
    const report = runDoctor(webApp({ '.tapthrough/scenarios/gone.json': scenario('/gone') }))
    const lines = formatDoctor(report).split('\n')
    expect(lines[0]).toBe('pass  app                Next.js app; 2 screens in app.')
    expect(lines).toContain(
      'fail  scenarios          2 scenarios, 1 problem. The service skips broken files; fix them, then run `tapthrough check`.',
    )
    expect(lines.at(-2)).toBe('8 passed, 0 warnings, 1 failed.')
    expect(lines.at(-1)).toBe(`Note: ${report.note}`)
  })
})

interface Sent {
  url: string
  method: string
  body: string | undefined
  headers: Record<string, string>
}

function headersOf(init: RequestInit | undefined) {
  const headers: Record<string, string> = {}
  new Headers(init?.headers).forEach((value, name) => {
    headers[name] = value
  })
  return headers
}

/** A fetch that answers from a table of `METHOD url` and records what was sent. */
function fakeFetch(answers: Record<string, Response | Error>) {
  const sent: Sent[] = []
  const doFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input)
    const method = init?.method ?? 'GET'
    sent.push({
      url,
      method,
      body: typeof init?.body === 'string' ? init.body : undefined,
      headers: headersOf(init),
    })
    const answer = answers[`${method} ${url}`]
    if (answer instanceof Error) throw answer
    return answer ?? new Response('<html>404</html>', { status: 404 })
  }) as typeof fetch
  return { doFetch, sent }
}

const PREVIEW = 'https://acme-git-fix.vercel.app'
const STATUS_URL = `GET ${PREVIEW}/api/tapthrough/launch?status=1`
const SEED_URL = `POST ${PREVIEW}/api/tapthrough/seed`

function status(seedEnvironment: unknown, seed = 'in-app') {
  return Response.json({
    tapthrough: {
      status: 1,
      enabled: true,
      testData: { configured: true, seed, auth: true },
      seedEnvironment,
    },
  })
}

function hookError(code: string, message: string, httpStatus: number) {
  return Response.json({ error: { code, message } }, { status: httpStatus })
}

describe('liveTarget', () => {
  it('tells a preview deployment from a seed hook', () => {
    expect(liveTarget(PREVIEW)).toEqual({ kind: 'preview', origin: PREVIEW })
    expect(liveTarget(`${PREVIEW}/api/tapthrough/launch/`)).toEqual({
      kind: 'preview',
      origin: PREVIEW,
    })
    expect(liveTarget('https://ref.supabase.co/functions/v1/tapthrough-seed')).toEqual({
      kind: 'hook',
      url: 'https://ref.supabase.co/functions/v1/tapthrough-seed',
    })
    expect(liveTarget('acme.vercel.app').kind).toBe('invalid')
    expect(liveTarget('ftp://acme.test').kind).toBe('invalid')
    expect(liveTarget('https://user:pass@acme.test').kind).toBe('invalid')
  })
})

describe('liveChecks on a preview deployment', () => {
  it('passes when the route is on and the seed environment is valid', async () => {
    const { doFetch, sent } = fakeFetch({
      [STATUS_URL]: status({ valid: true, value: 'staging' }),
      [SEED_URL]: hookError('invalid', 'Link token is invalid', 401),
    })
    const checks = await liveChecks(PREVIEW, { fetch: doFetch })
    expect(statuses(checks)).toEqual({
      'live-launch': 'pass',
      'live-seed-env': 'pass',
      'live-seed-hook': 'pass',
    })
    expect(byId(checks)['live-seed-env']?.message).toBe(
      'TAPTHROUGH_ENV is `staging` in this deployment.',
    )
    // Only these two requests, and never a real token or a credential.
    expect(sent.map((s) => `${s.method} ${s.url}`)).toEqual([STATUS_URL, SEED_URL])
    expect(sent[1]?.body).toBe('{"token":"doctor"}')
    for (const request of sent) {
      expect(Object.keys(request.headers).sort()).not.toContain('authorization')
      expect(Object.keys(request.headers)).not.toContain('cookie')
    }
  })

  it('fails when TAPTHROUGH_ENV is "true", from the status and from the hook', async () => {
    const { doFetch } = fakeFetch({
      [STATUS_URL]: status({ valid: false, set: true, length: 4 }),
      [SEED_URL]: hookError('not_staging', 'Seeding is disabled in environment "true"', 403),
    })
    const checks = byId(await liveChecks(PREVIEW, { fetch: doFetch }))
    expect(checks['live-seed-env']).toMatchObject({
      status: 'fail',
      message: expect.stringContaining("its 4-character value isn't `staging` or `development`"),
    })
    expect(checks['live-seed-hook']).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('It said: Seeding is disabled in environment "true".'),
    })
  })

  it('fails when TAPTHROUGH_ENV is unset, and skips a hook that is not at the usual path', async () => {
    const { doFetch } = fakeFetch({ [STATUS_URL]: status({ valid: false, set: false, length: 0 }) })
    const checks = await liveChecks(PREVIEW, { fetch: doFetch })
    expect(statuses(checks)).toEqual({ 'live-launch': 'pass', 'live-seed-env': 'fail' })
    expect(byId(checks)['live-seed-env']?.message).toContain(
      "TAPTHROUGH_ENV isn't set in this deployment.",
    )
  })

  it('points at the hook when it runs elsewhere, without calling it', async () => {
    const { doFetch, sent } = fakeFetch({
      [STATUS_URL]: status({ valid: false, set: false, length: 0 }, 'url'),
    })
    const checks = await liveChecks(PREVIEW, { fetch: doFetch })
    expect(statuses(checks)).toEqual({ 'live-launch': 'pass', 'live-seed-env': 'warn' })
    expect(sent).toHaveLength(1)
  })

  it('tells a missing route from one that is off', async () => {
    const missing = fakeFetch({})
    expect(await liveChecks(PREVIEW, { fetch: missing.doFetch, testData: 'on' })).toMatchObject([
      {
        id: 'live-launch',
        status: 'fail',
        message: expect.stringContaining('has no launch route'),
      },
    ])
    expect(await liveChecks(PREVIEW, { fetch: missing.doFetch, testData: 'off' })).toMatchObject([
      { id: 'live-launch', status: 'pass' },
    ])

    const off = fakeFetch({ [STATUS_URL]: new Response('Not found', { status: 404 }) })
    expect(await liveChecks(PREVIEW, { fetch: off.doFetch, testData: 'on' })).toMatchObject([
      {
        id: 'live-launch',
        status: 'warn',
        message: expect.stringContaining('says Tapthrough is off here'),
      },
    ])
  })

  it('recognises an older launch route, a login wall and a host that is down', async () => {
    const old = fakeFetch({
      [STATUS_URL]: new Response('<p>This link is incomplete.</p><code>missing_token</code>', {
        status: 400,
      }),
    })
    expect(await liveChecks(PREVIEW, { fetch: old.doFetch })).toMatchObject([
      { status: 'warn', message: expect.stringContaining('too old to report more') },
    ])

    const wall = fakeFetch({
      [STATUS_URL]: new Response('Authentication Required', { status: 401 }),
    })
    expect(await liveChecks(PREVIEW, { fetch: wall.doFetch })).toMatchObject([
      { status: 'warn', message: expect.stringContaining('Vercel Deployment Protection') },
    ])

    const down = fakeFetch({
      [STATUS_URL]: new TypeError('fetch failed', {
        cause: new Error('getaddrinfo ENOTFOUND acme-git-fix.vercel.app'),
      }),
    })
    expect(await liveChecks(PREVIEW, { fetch: down.doFetch })).toMatchObject([
      { status: 'fail', message: expect.stringContaining('getaddrinfo ENOTFOUND') },
    ])

    const other = fakeFetch({ [STATUS_URL]: Response.json({ ok: true }) })
    expect(await liveChecks(PREVIEW, { fetch: other.doFetch })).toMatchObject([
      { status: 'warn', message: expect.stringMatching(/^Couldn't tell/) },
    ])
  })
})

describe('liveChecks on a seed hook', () => {
  const HOOK = 'https://ref.supabase.co/functions/v1/tapthrough-seed'
  const check = async (answer: Response | Error) =>
    (await liveChecks(HOOK, { fetch: fakeFetch({ [`POST ${HOOK}`]: answer }).doFetch }))[0]

  it('reads the hook’s answer to a placeholder token', async () => {
    expect(await check(hookError('invalid', 'Link token is invalid', 401))).toMatchObject({
      id: 'live-seed-hook',
      status: 'pass',
    })
    expect(
      await check(hookError('not_staging', 'Seeding is disabled in environment "unset"', 403)),
    ).toMatchObject({
      status: 'fail',
      message: expect.stringContaining('Set TAPTHROUGH_ENV to exactly `staging`'),
    })
    expect(
      await check(hookError('keys_unavailable', "Couldn't reach Tapthrough", 502)),
    ).toMatchObject({
      status: 'warn',
    })
    expect(await check(new TypeError('fetch failed'))).toMatchObject({
      status: 'fail',
      message: expect.stringContaining("Couldn't reach the seed hook"),
    })
    expect(await check(new Response('nope', { status: 404 }))).toMatchObject({ status: 'fail' })
    // Supabase answers this itself when the function wants a JWT.
    expect(
      await check(
        Response.json({ code: 401, message: 'Missing authorization header' }, { status: 401 }),
      ),
    ).toMatchObject({
      status: 'warn',
      message: expect.stringMatching(/^Couldn't tell/),
    })
    expect(await check(new Response('oops', { status: 500 }))).toMatchObject({
      status: 'warn',
      message: "Couldn't tell: the seed hook answered 500.",
    })
  })

  it('prints what the hook said on one line', async () => {
    const result = await check(hookError('not_staging', 'bad\n\u001b[31menv', 403))
    expect(result?.message).toContain('It said: bad [31menv.')
  })
})

describe('withLiveChecks', () => {
  it('adds the live checks to the report and its totals', async () => {
    const { doFetch } = fakeFetch({})
    const report = runDoctor(webApp())
    const live = await liveChecks(PREVIEW, { fetch: doFetch, testData: report.testData })
    const full = withLiveChecks(report, live)
    expect(full.summary).toEqual({ pass: 10, warn: 0, fail: 0 })
    expect(full.checks.at(-1)?.id).toBe('live-launch')
  })
})

describe('runDoctor with fixtures', () => {
  const onFixtures = JSON.stringify({
    title: 'Notes',
    route: { path: '/' },
    seed: { tier: 1, fixtures: 'notes' },
  })
  const fixtureFile = JSON.stringify({ v: 1, routes: [{ url: '/notes', body: [] }] })
  const noHook = `export default { scheme: 'acme', plugins: [['@tapthrough/expo', {
      enabled: process.env.APP_VARIANT !== 'production',
    }]] }`

  it('needs no seed hook when every scenario uses fixtures', () => {
    const report = runDoctor(
      expoApp({
        'app.config.ts': noHook,
        '.tapthrough/scenarios/home.json': onFixtures,
        '.tapthrough/fixtures/notes.json': fixtureFile,
      }),
    )
    const checks = byId(report.checks)
    expect(checks['mobile-seed-hook']?.status).toBe('pass')
    expect(checks['mobile-seed-hook']?.message).toContain('No seed hook is needed')
    expect(checks.scenarios?.status).toBe('pass')
  })

  it('says how many scenarios still need a seed hook', () => {
    const report = runDoctor(
      expoApp({
        'app.config.ts': noHook,
        '.tapthrough/scenarios/home.json': onFixtures,
        '.tapthrough/scenarios/other.json': scenario('/'),
        '.tapthrough/fixtures/notes.json': fixtureFile,
      }),
    )
    const check = byId(report.checks)['mobile-seed-hook']
    expect(check?.status).toBe('warn')
    expect(check?.message).toContain('1 scenario needs one')
  })

  it('fails a scenario whose fixture file is missing', () => {
    const report = runDoctor(expoApp({ '.tapthrough/scenarios/home.json': onFixtures }))
    const check = byId(report.checks).scenarios
    expect(check?.status).toBe('fail')
    expect(check?.details?.[0]).toContain('fixtures "notes" not found')
  })

  it('fails fixtures on a web app, where they are not supported yet', () => {
    const report = runDoctor(
      webApp({
        '.tapthrough/scenarios/home.json': onFixtures,
        '.tapthrough/fixtures/notes.json': fixtureFile,
      }),
    )
    expect(byId(report.checks)['scenario-fixtures']?.status).toBe('fail')
  })
})

describe('liveChecks on the deployed app ID', () => {
  const withAppId = (appId: string) =>
    Response.json({
      tapthrough: {
        status: 1,
        enabled: true,
        appId,
        testData: { configured: true, seed: 'url', auth: true },
        seedEnvironment: { valid: true, value: 'staging' },
      },
    })

  it('passes when it matches the workflow, and fails when it differs', async () => {
    const same = fakeFetch({ [STATUS_URL]: withAppId('app.acme.com') })
    const ok = await liveChecks(PREVIEW, { fetch: same.doFetch, appId: 'app.acme.com' })
    expect(byId(ok)['live-app-id']?.status).toBe('pass')

    const other = fakeFetch({ [STATUS_URL]: withAppId('www.acme.com') })
    const bad = await liveChecks(PREVIEW, { fetch: other.doFetch, appId: 'app.acme.com' })
    expect(byId(bad)['live-app-id']?.status).toBe('fail')
    expect(byId(bad)['live-app-id']?.message).toContain('"www.acme.com"')
  })

  it('says nothing when the deployment or the workflow gives no app ID', async () => {
    const old = fakeFetch({ [STATUS_URL]: status({ valid: true, value: 'staging' }, 'url') })
    const checks = await liveChecks(PREVIEW, { fetch: old.doFetch, appId: 'app.acme.com' })
    expect(byId(checks)['live-app-id']).toBeUndefined()
  })
})

describe('checkLatest', () => {
  const registry = (versions: Record<string, string>) =>
    fakeFetch(
      Object.fromEntries(
        Object.entries(versions).map(([name, version]) => [
          `GET https://registry.npmjs.org/${name.replace('/', '%2f')}/latest`,
          Response.json({ version }),
        ]),
      ),
    )

  it('warns about packages behind the newest release, and names only the packages', async () => {
    const { doFetch, sent } = registry({
      '@tapthrough/next': '0.1.3',
      '@tapthrough/react': '0.2.2',
    })
    const checks = await checkLatest(
      { '@tapthrough/next': ['0.1.2'], '@tapthrough/react': ['0.2.2'], zod: ['3.0.0'] },
      doFetch,
    )
    expect(checks[0]?.status).toBe('warn')
    expect(checks[0]?.details).toEqual(['@tapthrough/next 0.1.2 → 0.1.3'])
    expect(sent).toHaveLength(2)
    expect(sent.every((request) => request.body === undefined)).toBe(true)
  })

  it('passes when everything is current, and says so when it cannot tell', async () => {
    const current = registry({ '@tapthrough/next': '0.1.3' })
    expect((await checkLatest({ '@tapthrough/next': ['0.1.3'] }, current.doFetch))[0]?.status).toBe(
      'pass',
    )
    const down = fakeFetch({})
    expect((await checkLatest({ '@tapthrough/next': ['0.1.3'] }, down.doFetch))[0]?.status).toBe(
      'warn',
    )
    expect((await checkLatest({}, down.doFetch))[0]?.status).toBe('warn')
  })
})
