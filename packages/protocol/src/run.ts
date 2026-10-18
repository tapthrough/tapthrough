import { z } from 'zod'
import { Platform } from './scenario.js'

export const RouteEntry = z.object({
  /** Expo Router path, e.g. `/notes/[id]/edit`. Groups like `(tabs)` are removed. */
  path: z.string().startsWith('/'),
  /** Source file, relative to the repo root. */
  file: z.string().min(1),
})
export type RouteEntry = z.infer<typeof RouteEntry>

export const AffectedRoute = z.object({
  path: z.string().startsWith('/'),
  /** Import hops from the changed file to the route file; 0 means the route file itself changed. */
  distance: z.number().int().nonnegative(),
  /** The changed file that reaches this route. */
  via: z.string().min(1),
})
export type AffectedRoute = z.infer<typeof AffectedRoute>

export const PresetSummary = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  /** JSON Schema of the preset's input. */
  input: z.record(z.string(), z.unknown()),
})
export type PresetSummary = z.infer<typeof PresetSummary>

/** What the Action works out on the customer's runner, without an LLM. */
export const Manifest = z.object({
  apiVersion: z.literal(1),
  framework: z.literal('expo-router'),
  routes: z.array(RouteEntry),
  changedFiles: z.array(z.string()),
  affected: z.array(AffectedRoute),
  presets: z.array(PresetSummary),
})
export type Manifest = z.infer<typeof Manifest>

export const MAX_DIFF_LENGTH = 2_000_000

/** Body of `POST /api/v1/runs`, sent by the Action once per push. */
export const RunReport = z.object({
  apiVersion: z.literal(1),
  repo: z.string().regex(/^[\w.-]+\/[\w.-]+$/),
  pr: z.number().int().positive(),
  sha: z.string().regex(/^[0-9a-f]{40}$/),
  platform: Platform,
  runtimeVersion: z.string().min(1),
  updateGroupId: z.string().min(1),
  manifest: Manifest,
  diff: z.string().max(MAX_DIFF_LENGTH),
  /** e.g. `#98` or `owner/repo#98`; absent when the PR links no ticket. */
  ticketRef: z.string().optional(),
})
export type RunReport = z.infer<typeof RunReport>
