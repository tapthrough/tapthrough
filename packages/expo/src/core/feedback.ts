import type { Platform } from '@tapthrough/protocol'

/** Which PR build is running, read from the loaded EAS update's manifest. */
export interface PreviewContext {
  updateGroupId: string
  /** The EAS Update branch, e.g. `pr-142`. */
  branch: string | undefined
}

/**
 * The update group of the running EAS update, from `Constants.manifest2`.
 * A development build has it however the update was opened (QR code, Orbit
 * or a Tapthrough link); an embedded or local build has none.
 */
export function previewContextFromManifest(manifest: unknown): PreviewContext | null {
  const metadata = (
    manifest as { metadata?: { updateGroup?: unknown; branchName?: unknown } } | null
  )?.metadata
  if (typeof metadata?.updateGroup !== 'string' || metadata.updateGroup === '') return null
  return {
    updateGroupId: metadata.updateGroup,
    branch: typeof metadata.branchName === 'string' ? metadata.branchName : undefined,
  }
}

/**
 * The scenario ID (`scn`) from a link token, for attributing reports. Read
 * without verification: the token was already verified by the seed hook and
 * redeemed, and the server checks the ID belongs to the same PR.
 */
export function scenarioIdFromToken(token: string): string | undefined {
  const payload = token.split('.')[1]
  if (!payload) return undefined
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json = JSON.parse(globalThis.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')))
    return typeof json.scn === 'string' ? json.scn : undefined
  } catch {
    return undefined
  }
}

export interface FeedbackInput {
  preview: PreviewContext
  platform: Platform
  body: string
  reporterName?: string
  route?: string
  scenarioId?: string
  device?: { os?: string; osVersion?: string; model?: string }
  screenshot?: { contentType: 'image/jpeg' | 'image/png'; base64: string }
}

export type FeedbackResult = { ok: true; commentUrl: string } | { ok: false; message: string }

/** Posts a report to Tapthrough, which comments it on the PR. Never throws. */
export async function sendFeedback(
  input: FeedbackInput,
  options: { apiUrl: string; fetch?: typeof fetch },
): Promise<FeedbackResult> {
  const doFetch = options.fetch ?? fetch
  let response: Response
  try {
    response = await doFetch(`${options.apiUrl.replace(/\/$/, '')}/api/v1/feedback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        apiVersion: 1,
        updateGroupId: input.preview.updateGroupId,
        platform: input.platform,
        body: input.body,
        ...(input.reporterName ? { reporterName: input.reporterName } : {}),
        ...(input.route ? { route: input.route } : {}),
        ...(input.scenarioId ? { scenarioId: input.scenarioId } : {}),
        ...(input.device ? { device: input.device } : {}),
        ...(input.screenshot ? { screenshot: input.screenshot } : {}),
      }),
    })
  } catch {
    return { ok: false, message: "Couldn't reach Tapthrough. Check your connection and try again." }
  }
  const body = (await response.json().catch(() => undefined)) as
    | { commentUrl?: string; error?: { message?: string } }
    | undefined
  if (response.ok && body?.commentUrl) return { ok: true, commentUrl: body.commentUrl }
  return { ok: false, message: body?.error?.message ?? `Tapthrough returned ${response.status}.` }
}
