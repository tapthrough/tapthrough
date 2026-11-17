/** The environment variables this package reads; `process.env` fits. */
export type Env = Record<string, string | undefined>

export interface PreviewEnv {
  /** Whether launch links and the Review panel are on in this deployment. */
  enabled: boolean
  /**
   * This deployment's own host, e.g. `acme-git-fix-title-acme.vercel.app`.
   * Reports carry it so Tapthrough can tell which pull request they belong to.
   */
  host: string | undefined
}

/**
 * Reads where the app is running. On Vercel, Tapthrough is on in preview
 * deployments and nowhere else. On other hosts set `TAPTHROUGH_ENABLED=true`
 * and `TAPTHROUGH_PREVIEW_HOST` in the preview environment only.
 *
 * A Vercel production deployment is never enabled, whatever else is set, so a
 * copied environment variable can't turn test logins on for real users.
 */
export function previewEnv(env: Env): PreviewEnv {
  const host = env.TAPTHROUGH_PREVIEW_HOST || env.VERCEL_URL || undefined
  if (env.VERCEL_ENV === 'production') return { enabled: false, host }
  if (env.TAPTHROUGH_ENABLED === 'false') return { enabled: false, host }
  return { enabled: env.VERCEL_ENV === 'preview' || env.TAPTHROUGH_ENABLED === 'true', host }
}
