/**
 * Whether the page at `pathname` is the one a scenario's route describes.
 * `routePath` is the file router's path, so `/jobs/[id]` matches `/jobs/42`
 * and `/docs/[...slug]` matches anything under `/docs/`.
 */
export function routeMatches(routePath: string, pathname: string | undefined): boolean {
  if (!pathname) return false
  const trim = (path: string) => (path.length > 1 ? path.replace(/\/+$/, '') : path)
  const pattern = trim(routePath)
    .split('/')
    .map((segment) => {
      if (/^\[\[\.\.\..+\]\]$/.test(segment)) return '.*'
      if (/^\[\.\.\..+\]$/.test(segment)) return '.+'
      if (/^\[.+\]$/.test(segment)) return '[^/]+'
      return segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    })
    .join('/')
  try {
    return new RegExp(`^${pattern}/?$`).test(trim(pathname))
  } catch {
    return false
  }
}
