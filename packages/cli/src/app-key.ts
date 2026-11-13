import { execFileSync } from 'node:child_process'

/** `owner/name` from a GitHub remote URL, SSH or HTTPS; undefined for anything else. */
export function repoFromRemote(url: string): string | undefined {
  const match = url.trim().match(/github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/)
  return match ? `${match[1]}/${match[2]}` : undefined
}

function run(command: string, args: string[], cwd: string): string | undefined {
  try {
    return execFileSync(command, args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {
    return undefined
  }
}

/** The repo to make a key for: `--repo`, or the `origin` remote of the app's directory. */
export function detectRepo(dir: string): string | undefined {
  const url = run('git', ['remote', 'get-url', 'origin'], dir)
  return url ? repoFromRemote(url) : undefined
}

/** Your GitHub token: $GITHUB_TOKEN, or the GitHub CLI's. Only sent to Tapthrough to check access. */
export function githubToken(dir: string): string | undefined {
  return process.env.GITHUB_TOKEN || run('gh', ['auth', 'token'], dir)
}

export async function requestAppKey(
  server: string,
  input: { repo: string; token: string },
): Promise<{ appKey: string; repo: string }> {
  const response = await fetch(`${server.replace(/\/$/, '')}/api/v1/app-keys`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${input.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ repo: input.repo }),
  })
  const body = (await response.json().catch(() => undefined)) as
    | { appKey?: string; repo?: string; error?: { message?: string } }
    | undefined
  if (!response.ok || !body?.appKey) {
    throw new Error(body?.error?.message ?? `Tapthrough returned ${response.status}.`)
  }
  return { appKey: body.appKey, repo: body.repo ?? input.repo }
}

/** What to put in the app config, with the key in an env var rather than in the repo. */
export function formatAppKey(result: { appKey: string; repo: string }): string {
  return [
    `App key for ${result.repo}:`,
    '',
    result.appKey,
    '',
    'Store it as an EAS environment variable (it goes into staging builds, not the repo):',
    '',
    '  eas env:create --name TAPTHROUGH_APP_KEY --value <key> --environment preview --visibility sensitive',
    '',
    'Then turn on the feedback button for those builds in app.config.ts:',
    '',
    "  ['@tapthrough/expo', {",
    "    staff: process.env.APP_VARIANT === 'staging',",
    '    appKey: process.env.TAPTHROUGH_APP_KEY,',
    '  }]',
    '',
    'Testers on those builds can then report issues and share ideas from the app.',
    'Never turn `staff` on for builds that go to the App Store or Play Store.',
  ].join('\n')
}
