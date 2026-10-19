import type { Platform } from '@tapthrough/protocol'

/** Which PR build is running, read from the loaded EAS update's manifest. */
export interface PreviewContext {
  updateGroupId: string
  /** The EAS project the update belongs to; the server checks it against the repo. */
  projectId: string
  /** The EAS Update branch, e.g. `pr-142`. */
  branch: string | undefined
}

/**
 * The update group of the running EAS update, from `Constants.manifest2`.
 * A development build has it however the update was opened (QR code, Orbit
 * or a Tapthrough link); an embedded or local build has none.
 */
export function previewContextFromManifest(manifest: unknown): PreviewContext | null {
  const m = manifest as {
    metadata?: { updateGroup?: unknown; branchName?: unknown }
    extra?: { eas?: { projectId?: unknown } }
  } | null
  const metadata = m?.metadata
  const projectId = m?.extra?.eas?.projectId
  if (typeof metadata?.updateGroup !== 'string' || metadata.updateGroup === '') return null
  if (typeof projectId !== 'string') return null
  return {
    updateGroupId: metadata.updateGroup,
    projectId,
    branch: typeof metadata.branchName === 'string' ? metadata.branchName : undefined,
  }
}

/** A link token's payload, read without verification (the seed hook and server verify). */
export function decodeTokenClaims(token: string): Record<string, unknown> | undefined {
  const payload = token.split('.')[1]
  if (!payload) return undefined
  try {
    const base64 = payload.replace(/-/g, '+').replace(/_/g, '/')
    const json: unknown = JSON.parse(
      globalThis.atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')),
    )
    return json && typeof json === 'object' ? (json as Record<string, unknown>) : undefined
  } catch {
    return undefined
  }
}

/**
 * The scenario ID (`scn`) from a link token, for attributing reports. The
 * server checks the ID belongs to the same PR.
 */
export function scenarioIdFromToken(token: string): string | undefined {
  const scn = decodeTokenClaims(token)?.scn
  return typeof scn === 'string' ? scn : undefined
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
        projectId: input.preview.projectId,
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
