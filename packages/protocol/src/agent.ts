import { z } from 'zod'
import { Platform, Route } from './scenario.js'

/**
 * What a coding agent needs to review one PR on a simulator: the build to open,
 * the scenarios to set up and the steps to check. Served by
 * `GET /api/v1/links/:linkId/agent` and printed by `tapthrough plan`.
 */
export const AgentBuild = z.object({
  platform: Platform,
  sha: z.string().min(1),
  updateGroupId: z.string().min(1),
  runtimeVersion: z.string().min(1),
  /** Opens this PR's EAS Update in the app's development build. */
  buildUrl: z.string().min(1),
})
export type AgentBuild = z.infer<typeof AgentBuild>

export const AgentStep = z.object({
  index: z.number().int().nonnegative(),
  action: z.string().min(1),
  expect: z.string().min(1),
  confidence: z.enum(['high', 'medium', 'low']),
})
export type AgentStep = z.infer<typeof AgentStep>

export const AgentScenario = z.object({
  key: z.string().min(1),
  title: z.string().min(1),
  route: Route,
  /** What the launch link does before the first step, in order. */
  setup: z.array(z.string()),
  /** Platforms with a build that can start this scenario. */
  platforms: z.array(Platform),
  steps: z.array(AgentStep),
})
export type AgentScenario = z.infer<typeof AgentScenario>

export const AgentPlan = z.object({
  apiVersion: z.literal(1),
  repo: z.string().min(1),
  pr: z.number().int().positive(),
  /** Closed PRs have no live builds; agents should stop. */
  expired: z.boolean(),
  app: z.object({
    scheme: z.string().nullable(),
    expoProjectId: z.string().nullable(),
  }),
  builds: z.array(AgentBuild),
  scenarios: z.array(AgentScenario),
  /** POST `{ platform, scenario }` here for a single-use, 15-minute launch link. */
  launchEndpoint: z.string().min(1),
})
export type AgentPlan = z.infer<typeof AgentPlan>

/** Response of the launch endpoint. */
export const AgentLaunch = z.object({
  launchUrl: z.string().min(1),
  expiresAt: z.string().min(1),
})
export type AgentLaunch = z.infer<typeof AgentLaunch>
