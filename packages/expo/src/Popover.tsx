import { type ReactNode, useEffect, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  Linking,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type ViewStyle,
} from 'react-native'
import type { Bounds } from './core/bubble.js'
import type {
  Checklist,
  ChecklistReset,
  ChecklistScenario,
  NewerBuild,
  RecheckItem,
  SetupLine,
} from './core/feedback.js'
import { resetMessage } from './core/feedback.js'
import {
  type Idea,
  type IdeaStage,
  type OpenPr,
  prsToReview,
  type Report,
  stepTime,
} from './core/ideas.js'
import {
  nextOpenScenario,
  type Placement,
  type Results,
  type ScenarioProgress,
  type SetupProgress,
  scenarioProgress,
  screenPosition,
  setupLineStates,
  stepId,
} from './core/review.js'
import { useBackPress } from './Overlay.js'
import { useReduceMotion } from './ui/native.js'
import { Capsule, CircleButton, Icon, type IconName, Surface } from './ui/parts.js'
import { type Colors, SPRING, text, useColors } from './ui/theme.js'

/** Where the reviewer is inside the popover. Kept by the parent so it resumes there. */
export type Nav =
  | { view: 'list' }
  | { view: 'brief'; key: string }
  | { view: 'setup'; key: string }
  /** `index` is the step's position in the scenario's `steps`. */
  | { view: 'step'; key: string; index: number }
  | { view: 'done'; key: string }
  | { view: 'recheck'; id: string }
  | { view: 'idea'; id: string }
  /** A bug sent from this staging or TestFlight app, and Claude's fix. */
  | { view: 'report'; id: string }
  /** The repo's other open PRs, to switch builds. */
  | { view: 'prs' }

export type Direction = 'forward' | 'back'

export interface SetupStatus {
  key: string
  progress: SetupProgress
  error?: string
}

export interface ReviewPopoverProps {
  checklist: Checklist
  results: Results
  rechecked: Record<string, 'fixed' | 'still_broken'>
  nav: Nav
  direction: Direction
  onNav: (next: Nav, direction: Direction) => void
  placement: Placement
  bounds: Bounds
  full: boolean
  onToggleFull: () => void
  onClose: () => void
  /** False when the app has no seed hook, so setup can only be described. */
  canSetUp: boolean
  setup: SetupStatus | null
  onSetUp: (key: string) => void
  /** Begins a scenario's steps (or, for another state, exploring) without setting up. */
  onStart: (key: string) => void
  onPass: (key: string, index: number) => void
  onFail: (key: string, index: number) => void
  onRecheck: (item: RecheckItem, result: 'fixed' | 'still_broken') => void
  onReportOther: () => void
  /**
   * A staging or TestFlight build, with its version for the header: no PR to
   * check, so the panel is just feedback and ideas.
   */
  staff: string | null
  /** The app's recent ideas, newest first. */
  ideas: Idea[]
  onShareIdea: () => void
  onAnswerIdea: (id: string, answers: string[]) => void
  onReplyIdea: (id: string, reply: string) => void
  onIdeaAction: (id: string, action: 'build' | 'retry' | 'approve') => void
  /** Bugs sent from staging and TestFlight builds, newest first, with Claude's fixes. */
  reports: Report[]
  onFixReport: (id: string) => void
  /** The idea or report whose request is in flight, to show a spinner on its button. */
  ideaBusy: string | null
  /** What Approve PR did, once it has. */
  approveNote: string | null
  /** "PR ready" notifications on this device; null when the app doesn't offer them. */
  push: 'on' | 'off' | null
  onEnablePush: () => void
  onApprovePr: () => void
  /** Open PRs with previews; null until loaded. */
  pulls: OpenPr[] | null
  onShowPulls: () => void
  onSwitchPr: (pr: OpenPr) => void
  name: string
  onNameChange: (name: string) => void
  error: string | null
}

interface Entry {
  key: string
  title: string
  why?: string | null | undefined
  setup?: SetupLine[] | undefined
  scenario?: ChecklistScenario
  /** A state from the library rather than the PR's plan. */
  other: boolean
}

/** Scenario reasons are written for the PR comment; drop its code marks here. */
function plain(text: string | null | undefined) {
  return text?.replace(/`([^`]*)`/g, '$1')
}

function entryFor(checklist: Checklist, key: string): Entry | undefined {
  const scenario = checklist.scenarios.find((s) => s.key === key)
  if (scenario) {
    return {
      key,
      title: scenario.title,
      why: plain(scenario.why),
      setup: scenario.setup,
      scenario,
      other: false,
    }
  }
  const state = checklist.library?.find((s) => s.key === key)
  if (state)
    return { key, title: state.title, why: plain(state.why), setup: state.setup, other: true }
  return undefined
}

const navKey = (nav: Nav) =>
  nav.view === 'list' || nav.view === 'prs'
    ? nav.view
    : nav.view === 'recheck' || nav.view === 'idea' || nav.view === 'report'
      ? `${nav.view}:${nav.id}`
      : nav.view === 'step'
        ? `step:${nav.key}:${nav.index}`
        : `${nav.view}:${nav.key}`

interface Screen {
  title: string
  subtitle?: string
  /** Shows ‹ and goes back to the list. */
  back?: boolean
  body: ReactNode
  footer?: ReactNode
}

/**
 * The review popover: grows out of the Review button, lists what to test,
 * sets the app up for a scenario and walks through its steps. The middle
 * scrolls when it's long; the expand button turns it into a full-height sheet.
 */
export function ReviewPopover(props: ReviewPopoverProps) {
  const { nav, full, placement, bounds, onNav, onClose } = props
  const colors = useColors()
  const reduceMotion = useReduceMotion()
  const shown = useRef(new Animated.Value(0)).current
  const slide = useRef(new Animated.Value(0)).current
  const fade = useRef(new Animated.Value(1)).current
  const key = navKey(nav)
  const firstKey = useRef(key)

  useEffect(() => {
    if (reduceMotion) {
      shown.setValue(1)
      return
    }
    Animated.spring(shown, { toValue: 1, ...SPRING, useNativeDriver: true }).start()
  }, [shown, reduceMotion])

  // Deeper slides in from the right, back from the left.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the view changes
  useEffect(() => {
    if (key === firstKey.current || reduceMotion) return
    firstKey.current = ''
    slide.setValue(props.direction === 'back' ? -18 : 18)
    fade.setValue(0)
    Animated.parallel([
      Animated.timing(slide, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.timing(fade, { toValue: 1, duration: 180, useNativeDriver: true }),
    ]).start()
  }, [key])

  useBackPress(() => {
    if (full) props.onToggleFull()
    else if (nav.view === 'list' || nav.view === 'setup') onClose()
    else onNav({ view: 'list' }, 'back')
  })

  const view = renderView(props, colors)
  const frame: ViewStyle = full
    ? { left: 8, right: 8, top: Math.max(bounds.insetTop - 8, 8), bottom: 8 }
    : {
        width: placement.width,
        maxHeight: placement.maxHeight,
        [placement.side]: placement.inset,
        ...(placement.vertical === 'above'
          ? { bottom: placement.offset }
          : { top: placement.offset }),
      }

  return (
    <Animated.View
      style={[
        styles.frame,
        frame,
        {
          // No opacity here: fading a view that holds glass stops the glass rendering.
          transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] }) }],
          transformOrigin: `${placement.side} ${placement.vertical === 'above' ? 'bottom' : 'top'}`,
        },
      ]}
      accessibilityViewIsModal={full}
    >
      <Surface radius={full ? 38 : 30} style={[styles.surface, full && styles.grow]}>
        <Animated.View
          style={[
            styles.column,
            full && styles.grow,
            { opacity: Animated.multiply(fade, shown), transform: [{ translateX: slide }] },
          ]}
        >
          <View style={styles.header}>
            {view.back ? (
              <CircleButton
                icon="chevron.left"
                label="Back"
                onPress={() => onNav({ view: 'list' }, 'back')}
              />
            ) : null}
            <View style={[styles.headerText, !view.back && styles.headerTextAlone]}>
              <Text style={[text.headline, { color: colors.label }]} numberOfLines={2}>
                {view.title}
              </Text>
              {view.subtitle ? (
                <Text style={[text.footnote, { color: colors.secondary }]} numberOfLines={1}>
                  {view.subtitle}
                </Text>
              ) : null}
            </View>
            <CircleButton
              icon={
                full ? 'arrow.down.right.and.arrow.up.left' : 'arrow.up.left.and.arrow.down.right'
              }
              label={full ? 'Shrink' : 'Expand to full screen'}
              onPress={props.onToggleFull}
            />
            {full ? <CircleButton icon="xmark" label="Close" onPress={onClose} /> : null}
          </View>
          <ScrollView
            style={full ? styles.grow : styles.scroll}
            contentContainerStyle={styles.body}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
          >
            {view.body}
            {props.error ? (
              <Text style={[text.footnote, { color: colors.fail }]} accessibilityRole="alert">
                {props.error}
              </Text>
            ) : null}
          </ScrollView>
          {view.footer ? (
            <View style={[styles.footer, full && styles.footerFull]}>{view.footer}</View>
          ) : null}
        </Animated.View>
      </Surface>
    </Animated.View>
  )
}

function renderView(p: ReviewPopoverProps, colors: Colors): Screen {
  const { nav, checklist } = p
  if (nav.view === 'list') return listView(p, colors)
  if (nav.view === 'prs') return prsView(p, colors)
  if (nav.view === 'idea') {
    const idea = p.ideas.find((i) => i.id === nav.id)
    return idea ? ideaView(p, idea, colors) : listView(p, colors)
  }
  if (nav.view === 'report') {
    const report = p.reports.find((r) => r.id === nav.id)
    return report ? reportView(p, report, colors) : listView(p, colors)
  }
  if (nav.view === 'recheck') {
    const item = checklist.recheck?.find((r) => r.id === nav.id)
    return item ? recheckView(p, item, colors) : listView(p, colors)
  }
  const entry = entryFor(checklist, nav.key)
  if (!entry) return listView(p, colors)
  switch (nav.view) {
    case 'brief':
      return briefView(p, entry, colors)
    case 'setup':
      return setupView(p, entry, colors)
    case 'step':
      return entry.scenario
        ? stepView(p, entry, entry.scenario, nav.index, colors)
        : listView(p, colors)
    case 'done':
      return doneView(p, entry, colors)
  }
}

/* ---------------------------------- views --------------------------------- */

function listView(p: ReviewPopoverProps, colors: Colors): Screen {
  return p.staff ? staffListView(p, colors) : prListView(p, colors)
}

/** What's left on this PR and its one next action. */
function prProgress(p: ReviewPopoverProps) {
  const { checklist, results } = p
  const scenarios = checklist.scenarios.filter((s) => s.steps.length > 0)
  const recheck = (checklist.recheck ?? []).filter(
    (item) => !(p.rechecked[item.id] ?? (item.stillBrokenHere ? 'still_broken' : undefined)),
  )
  const progress = scenarios.map((s) => scenarioProgress(s, results))
  const done = progress.filter((pr) => pr.state !== 'new' && pr.state !== 'partial').length
  const failed = progress.reduce((n, pr) => n + pr.failed, 0)
  const next = nextOpenScenario(checklist, results)
  return { scenarios, recheck, done, failed, next, total: scenarios.length }
}

/**
 * The PR's review: what to check, one obvious next action, and once it's all
 * checked, other PRs to review. Only things the reviewer can act on are listed.
 */
function prListView(p: ReviewPopoverProps, colors: Colors): Screen {
  const { checklist, results } = p
  const { scenarios, recheck, done, failed, next, total } = prProgress(p)
  const finished = !next && recheck.length === 0
  const nothingPlanned = total === 0 && (checklist.recheck ?? []).length === 0
  const ideas = p.ideas.filter(
    (idea) =>
      idea.status === 'needs_answers' || idea.status === 'ready_to_test' || Boolean(idea.warning),
  )
  const others = prsToReview(p.pulls)
  const approved = Boolean(p.pulls?.find((pr) => pr.current)?.approved)
  const canApprove = !approved && (nothingPlanned || (finished && failed === 0))

  let lead: string
  if (approved) {
    lead = p.approveNote ?? `PR #${checklist.pr} is approved.`
  } else if (nothingPlanned) {
    lead = 'Nothing to check on this PR. Look around the app, report anything off, then approve it.'
  } else if (finished) {
    const unit = checklist.walkthrough ? 'screen' : 'step'
    lead = failed
      ? `${failed} ${unit}${failed === 1 ? '' : 's'} failed, and your reports are on PR #${checklist.pr}. Fixed now? Check again and tap Pass.`
      : `Everything passed. Approve PR #${checklist.pr} to tell the team it’s good to merge.`
  } else if (done === 0 && recheck.length === 0 && checklist.walkthrough) {
    // Only shared code changed: say what changed, then go screen by screen.
    lead = checklist.walkthrough.intro
  } else if (done === 0 && recheck.length === 0) {
    lead = `Check ${total === 1 ? 'this' : `these ${total}`} on PR #${checklist.pr}. Each one sets the app up and walks you through it.`
  } else {
    const left = total - done + recheck.length
    lead = `${left} left to check on PR #${checklist.pr}.`
  }

  let footer: ReactNode
  if (canApprove) {
    footer = (
      <Capsule
        title={`Approve PR #${checklist.pr}`}
        busy={p.ideaBusy === 'approve-pr'}
        onPress={p.onApprovePr}
      />
    )
  } else if (approved) {
    footer = <Capsule title="Done" kind={others.length ? 'plain' : undefined} onPress={p.onClose} />
  } else if (recheck[0]) {
    const item = recheck[0]
    footer = (
      <Capsule
        title="Re-check Earlier Report"
        onPress={() => p.onNav({ view: 'recheck', id: item.id }, 'forward')}
      />
    )
  } else if (next) {
    const started = scenarioProgress(next, results).checked > 0
    footer = (
      <Capsule
        title={`${started ? 'Continue' : done === 0 ? 'Start' : 'Next'}: ${next.title}`}
        onPress={() => p.onNav(openScenario(next, results), 'forward')}
      />
    )
  } else if (failed > 0) {
    const scenario = scenarios.find((s) => firstFailed(s, results) >= 0)
    footer = scenario ? (
      <Capsule
        title="Check Failed Step Again"
        onPress={() =>
          p.onNav(
            { view: 'step', key: scenario.key, index: firstFailed(scenario, results) },
            'forward',
          )
        }
      />
    ) : (
      <Capsule title="Done" onPress={p.onClose} />
    )
  } else {
    footer = <Capsule title="Done" kind={others.length ? 'plain' : undefined} onPress={p.onClose} />
  }

  return {
    title: `PR #${checklist.pr}`,
    subtitle: approved
      ? 'Approved'
      : nothingPlanned
        ? 'Nothing to check'
        : finished
          ? failed
            ? `${failed} failed`
            : 'All passed'
          : `${done} of ${total} checked`,
    body: (
      <>
        {checklist.newerBuild ? <NewerRow build={checklist.newerBuild} colors={colors} /> : null}
        {checklist.reset ? <ResetRow reset={checklist.reset} colors={colors} /> : null}
        <Text style={[text.subhead, { color: colors.label }]}>{lead}</Text>
        {approved
          ? null
          : (checklist.recheck ?? []).map((item) => {
              const state =
                p.rechecked[item.id] ?? (item.stillBrokenHere ? 'still_broken' : undefined)
              return (
                <Row
                  key={item.id}
                  colors={colors}
                  lead={
                    state ? (
                      <Mark kind={state === 'fixed' ? 'pass' : 'fail'} colors={colors} />
                    ) : (
                      <Badge icon="arrow.clockwise" colors={colors} />
                    )
                  }
                  title={`Re-check: ${item.excerpt}`}
                  subtitle={
                    state === 'fixed'
                      ? 'Fixed here'
                      : state
                        ? 'Still broken here'
                        : reportedBy(item)
                  }
                  onPress={() => p.onNav({ view: 'recheck', id: item.id }, 'forward')}
                />
              )
            })}
        {approved
          ? null
          : scenarios.map((scenario) => {
              const progress = scenarioProgress(scenario, results)
              return (
                <Row
                  key={scenario.key}
                  colors={colors}
                  lead={<ProgressMark progress={progress} colors={colors} />}
                  title={scenario.title}
                  subtitle={scenarioSubtitle(
                    scenario,
                    progress,
                    p.canSetUp,
                    Boolean(checklist.walkthrough),
                  )}
                  onPress={() => p.onNav(openScenario(scenario, results), 'forward')}
                />
              )
            })}
        {ideas.length ? (
          <>
            <Text style={[text.footnote, styles.section, { color: colors.secondary }]}>
              Ideas waiting on you
            </Text>
            {ideas.slice(0, 5).map((idea) => (
              <IdeaRow key={idea.id} idea={idea} p={p} colors={colors} />
            ))}
          </>
        ) : null}
        {approved || (finished && !canApprove) ? (
          <>
            <Text style={[text.footnote, styles.section, { color: colors.secondary }]}>
              Review another PR
            </Text>
            {p.pulls === null ? (
              <ActivityIndicator color={colors.secondary} />
            ) : others.length === 0 ? (
              <Text style={[text.subhead, { color: colors.secondary }]}>
                No other PRs are waiting for a review.
              </Text>
            ) : (
              others.map((pr) => <PullRow key={pr.number} pr={pr} p={p} colors={colors} />)
            )}
            {p.push === 'off' ? (
              <Row
                colors={colors}
                lead={<Badge icon="bell" colors={colors} />}
                title="Notify Me About New PRs"
                subtitle="Get a notification when a PR is ready to review"
                onPress={p.onEnablePush}
              />
            ) : null}
          </>
        ) : null}
        <ReviewerName name={p.name} onChange={p.onNameChange} colors={colors} />
      </>
    ),
    footer: (
      <>
        {footer}
        <View style={styles.pair}>
          <Capsule
            title="Report Issue"
            kind="plain"
            onPress={p.onReportOther}
            style={styles.half}
          />
          <Capsule title="Share Idea" kind="plain" onPress={p.onShareIdea} style={styles.half} />
        </View>
      </>
    ),
  }
}

function IdeaRow({ idea, p, colors }: { idea: Idea; p: ReviewPopoverProps; colors: Colors }) {
  return (
    <Row
      colors={colors}
      lead={
        <Badge
          icon="lightbulb"
          colors={colors}
          attention={
            idea.status === 'needs_answers' ||
            idea.status === 'ready_to_test' ||
            Boolean(idea.warning)
          }
        />
      }
      title={ideaTitle(idea)}
      subtitle={
        idea.warning
          ? `${idea.statusLine} · taking longer than usual`
          : idea.status === 'failed' || idea.status === 'not_set_up'
            ? `${idea.statusLine} · tap to see why`
            : idea.statusLine
      }
      onPress={() => p.onNav({ view: 'idea', id: idea.id }, 'forward')}
    />
  )
}

function PullRow({ pr, p, colors }: { pr: OpenPr; p: ReviewPopoverProps; colors: Colors }) {
  return (
    <Row
      colors={colors}
      lead={
        pr.current ? (
          <Mark kind="pass" colors={colors} />
        ) : (
          <Badge icon={pr.fromIdea ? 'lightbulb' : 'arrow.triangle.branch'} colors={colors} />
        )
      }
      title={`#${pr.number} ${pr.title}`}
      subtitle={
        pr.current
          ? 'Open now'
          : pr.needsNewBuild
            ? pr.pageUrl
              ? 'Changes native code: tap to install its build'
              : 'Changes native code: needs a new build of this app'
            : [
                pr.toCheck === undefined
                  ? null
                  : pr.toCheck > 0
                    ? `${pr.toCheck} to check`
                    : 'Nothing to check: look and approve',
                pr.fromIdea ? 'From an idea' : null,
                pr.author,
                pr.draft ? 'Draft' : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Open its build'
      }
      onPress={() => {
        if (pr.current) p.onNav({ view: 'list' }, 'back')
        else if (pr.openUrl) p.onSwitchPr(pr)
        // This app can't load it: its page has the PR's own build to install first.
        else if (pr.pageUrl) Linking.openURL(pr.pageUrl)
      }}
    />
  )
}

/** The installed staging or TestFlight build: the team's bugs and ideas, and ways to send more. */
function staffListView(p: ReviewPopoverProps, colors: Colors): Screen {
  const { checklist, results } = p
  const scenarios = checklist.scenarios.filter((s) => s.steps.length > 0)
  const recheck = checklist.recheck ?? []
  const counts = [
    scenarios.length ? `${scenarios.length} to test` : null,
    recheck.length ? `${recheck.length} to re-check` : null,
  ].filter(Boolean)
  return {
    // Say plainly which build this is: a PR's code, or the installed staging/TestFlight build.
    title: p.staff ?? `PR #${checklist.pr}`,
    subtitle: p.staff
      ? 'Not a PR build · send feedback and ideas'
      : [checklist.sha ? checklist.sha.slice(0, 7) : null, counts.join(' · ') || 'Nothing planned']
          .filter(Boolean)
          .join(' · '),
    body: (
      <>
        {checklist.newerBuild ? <NewerRow build={checklist.newerBuild} colors={colors} /> : null}
        {checklist.reset ? <ResetRow reset={checklist.reset} colors={colors} /> : null}
        {recheck.map((item) => {
          const done = p.rechecked[item.id] ?? (item.stillBrokenHere ? 'still_broken' : undefined)
          return (
            <Row
              key={item.id}
              colors={colors}
              lead={
                done ? (
                  <Mark kind={done === 'fixed' ? 'pass' : 'fail'} colors={colors} />
                ) : (
                  <Badge icon="arrow.clockwise" colors={colors} />
                )
              }
              title={`Re-check: ${item.excerpt}`}
              subtitle={
                done === 'fixed' ? 'Fixed here' : done ? 'Still broken here' : reportedBy(item)
              }
              onPress={() => p.onNav({ view: 'recheck', id: item.id }, 'forward')}
            />
          )
        })}
        {scenarios.map((scenario) => {
          const progress = scenarioProgress(scenario, results)
          return (
            <Row
              key={scenario.key}
              colors={colors}
              lead={<ProgressMark progress={progress} colors={colors} />}
              title={scenario.title}
              subtitle={scenarioSubtitle(scenario, progress, p.canSetUp)}
              onPress={() => p.onNav(openScenario(scenario, results), 'forward')}
            />
          )
        })}
        {p.ideas.length ? (
          <>
            <Text style={[text.footnote, styles.section, { color: colors.secondary }]}>Ideas</Text>
            {p.ideas.slice(0, 5).map((idea) => (
              <Row
                key={idea.id}
                colors={colors}
                lead={
                  <Badge
                    icon="lightbulb"
                    colors={colors}
                    attention={
                      idea.status === 'needs_answers' ||
                      idea.status === 'ready_to_test' ||
                      Boolean(idea.warning)
                    }
                  />
                }
                title={ideaTitle(idea)}
                subtitle={
                  idea.warning
                    ? `${idea.statusLine} · taking longer than usual`
                    : idea.status === 'failed' || idea.status === 'not_set_up'
                      ? `${idea.statusLine} · tap to see why`
                      : idea.statusLine
                }
                onPress={() => p.onNav({ view: 'idea', id: idea.id }, 'forward')}
              />
            ))}
          </>
        ) : null}
        {p.reports.length ? (
          <>
            <Text style={[text.footnote, styles.section, { color: colors.secondary }]}>Bugs</Text>
            {p.reports.slice(0, 5).map((report) => (
              <Row
                key={report.id}
                colors={colors}
                lead={
                  <Badge
                    icon="ladybug"
                    colors={colors}
                    attention={report.fix?.status === 'ready'}
                  />
                }
                title={report.title}
                subtitle={report.statusLine}
                onPress={() => p.onNav({ view: 'report', id: report.id }, 'forward')}
              />
            ))}
          </>
        ) : null}
        {p.staff ? (
          p.ideas.length || p.reports.length ? null : (
            <Text style={[text.subhead, { color: colors.secondary }]}>
              Something wrong? Report it, and it becomes a GitHub issue with a screenshot. Got an
              idea? Claude writes it up, and can build it.
            </Text>
          )
        ) : (
          <Row
            colors={colors}
            lead={<Badge icon="arrow.triangle.branch" colors={colors} />}
            title="Switch PR"
            subtitle="Open another pull request’s build"
            onPress={() => {
              p.onShowPulls()
              p.onNav({ view: 'prs' }, 'forward')
            }}
          />
        )}
        <ReviewerName name={p.name} onChange={p.onNameChange} colors={colors} />
      </>
    ),
    footer: (
      <View style={styles.pair}>
        <Capsule title="Report Issue" kind="plain" onPress={p.onReportOther} style={styles.half} />
        <Capsule title="Share Idea" kind="plain" onPress={p.onShareIdea} style={styles.half} />
      </View>
    ),
  }
}

function ideaTitle(idea: Idea) {
  if (idea.title) return idea.title
  const flat = idea.body.replace(/\s+/g, ' ')
  return flat.length > 60 ? `${flat.slice(0, 59)}…` : flat
}

function ideaView(p: ReviewPopoverProps, idea: Idea, colors: Colors): Screen {
  const busy = p.ideaBusy === idea.id
  const here = idea.prNumber !== null && idea.prNumber === p.checklist.pr
  const links = [
    idea.prUrl ? { title: `PR #${idea.prNumber}`, url: idea.prUrl } : null,
    idea.issueUrl ? { title: `Issue #${idea.issueNumber}`, url: idea.issueUrl } : null,
  ].filter((l): l is { title: string; url: string } => l !== null)
  let footer: ReactNode = null
  if (idea.actions.includes('build')) {
    footer = (
      <Capsule title="Build It" busy={busy} onPress={() => p.onIdeaAction(idea.id, 'build')} />
    )
  } else if (idea.actions.includes('approve') && p.staff) {
    // A staging or TestFlight build can't load a PR's code; that takes the development build.
    footer = idea.previewUrl ? (
      <Capsule
        title={`Open PR #${idea.prNumber} Page`}
        kind="plain"
        onPress={() => Linking.openURL(idea.previewUrl as string)}
      />
    ) : null
  } else if (idea.actions.includes('approve')) {
    footer = here ? (
      <Capsule title="Approve" busy={busy} onPress={() => p.onIdeaAction(idea.id, 'approve')} />
    ) : (
      <Capsule
        title="Open Build to Test"
        onPress={() => {
          const pr = p.pulls?.find((pull) => pull.number === idea.prNumber)
          if (pr?.openUrl) p.onSwitchPr(pr)
          else if (pr?.pageUrl) Linking.openURL(pr.pageUrl)
          else if (idea.previewUrl) Linking.openURL(idea.previewUrl)
        }}
      />
    )
  } else if (idea.actions.includes('retry')) {
    footer = (
      <Capsule
        title="Try Again"
        kind="plain"
        busy={busy}
        onPress={() => p.onIdeaAction(idea.id, 'retry')}
      />
    )
  }
  return {
    title: ideaTitle(idea),
    subtitle: idea.statusLine,
    back: true,
    body: (
      <>
        {idea.summary ? (
          <Text style={[text.subhead, { color: colors.label }]}>{idea.summary}</Text>
        ) : (
          <Text style={[text.subhead, { color: colors.label }]}>“{idea.body}”</Text>
        )}
        {idea.warning ? (
          <View style={[styles.newer, { backgroundColor: colors.fill }]}>
            <Icon name="flag.fill" size={16} color={colors.fail} />
            <View style={styles.rowText}>
              <Text style={[text.footnote, { color: colors.label }]}>{idea.warning}</Text>
              <LinkRow
                links={[
                  idea.runUrl ? { title: 'View Run', url: idea.runUrl } : null,
                  idea.actionsUrl ? { title: 'Open Actions', url: idea.actionsUrl } : null,
                ]}
                colors={colors}
              />
            </View>
          </View>
        ) : null}
        {idea.stages?.length ? (
          <Timeline stages={idea.stages} colors={colors} />
        ) : idea.note ? (
          <Text style={[text.footnote, { color: colors.secondary }]}>{idea.note}</Text>
        ) : null}
        {!idea.stages?.length && (idea.status === 'grooming' || idea.status === 'building') ? (
          <View style={styles.pair}>
            <ActivityIndicator color={colors.secondary} />
            <Text style={[text.footnote, styles.rowText, { color: colors.secondary }]}>
              {idea.status === 'grooming'
                ? 'Claude is reading the code and writing it up. This takes a minute or two.'
                : 'Claude is building it. You’ll get a build to test when the PR’s preview is ready.'}
            </Text>
          </View>
        ) : null}
        {idea.actions.includes('answer') ? (
          <IdeaAnswers
            key={idea.id}
            questions={idea.questions}
            busy={busy}
            onSend={(answers) => p.onAnswerIdea(idea.id, answers)}
            colors={colors}
          />
        ) : null}
        {idea.actions.includes('reply') ? (
          <IdeaReply
            key={idea.id}
            busy={busy}
            onSend={(reply) => p.onReplyIdea(idea.id, reply)}
            colors={colors}
          />
        ) : null}
        {idea.steps.length && idea.status !== 'needs_answers' && idea.status !== 'declined' ? (
          <Section title="How to test it" colors={colors}>
            <Numbered
              items={idea.steps.map((s) => ({ title: s.action, detail: s.expect }))}
              colors={colors}
            />
          </Section>
        ) : null}
        {idea.actions.includes('approve') ? (
          <Text style={[text.footnote, { color: colors.secondary }]}>
            {p.staff
              ? `You’re on ${p.staff}, not a PR build, so PR #${idea.prNumber} can’t open here. Open it on a phone with the development build, or in a simulator from the PR’s page. Approve it from there.`
              : here
                ? 'You’re on this idea’s build. Try the steps; if it’s right, approve it.'
                : 'Open its build, try the steps, then approve it from there.'}
          </Text>
        ) : null}
        <LinkRow
          links={[
            ...links,
            idea.runUrl && !idea.warning ? { title: 'Workflow Run', url: idea.runUrl } : null,
          ]}
          colors={colors}
        />
      </>
    ),
    footer,
  }
}

function reportView(p: ReviewPopoverProps, report: Report, colors: Colors): Screen {
  const busy = p.ideaBusy === report.id
  const fix = report.fix
  const here = fix?.prNumber != null && fix.prNumber === p.checklist.pr
  let footer: ReactNode = null
  if (fix?.status === 'ready' && !here) {
    footer = p.staff ? (
      fix.pageUrl ? (
        <Capsule
          title={`Open PR #${fix.prNumber} Page`}
          kind="plain"
          onPress={() => Linking.openURL(fix.pageUrl as string)}
        />
      ) : null
    ) : (
      <Capsule
        title="Open Fix to Test"
        onPress={() => {
          const pr = p.pulls?.find((pull) => pull.number === fix.prNumber)
          if (pr?.openUrl) p.onSwitchPr(pr)
          else if (pr?.pageUrl ?? fix.pageUrl)
            Linking.openURL((pr?.pageUrl ?? fix.pageUrl) as string)
          else if (fix.prUrl) Linking.openURL(fix.prUrl)
        }}
      />
    )
  } else if (report.canFix) {
    footer = (
      <Capsule
        title={fix ? 'Try Again' : 'Fix with Claude'}
        {...(fix ? { kind: 'plain' as const } : {})}
        busy={busy}
        onPress={() => p.onFixReport(report.id)}
      />
    )
  }
  let explain: string | null = null
  if (!fix) {
    explain =
      'It’s a GitHub issue. Fix with Claude has Claude fix it from your screenshot and the app’s logs, and open a PR you can test.'
  } else if (fix.status === 'ready') {
    explain = here
      ? 'You’re on the fix’s build. Check it’s fixed, then merge the PR on GitHub.'
      : p.staff
        ? `You’re on ${p.staff}, not a PR build, so PR #${fix.prNumber} can’t open here. Open it on a phone with the development build, or in a simulator from the PR’s page.`
        : 'Open the fix’s build and check it’s fixed.'
  } else if (fix.status === 'not_set_up') {
    explain =
      'Claude fixes bugs in the repo’s Fix with Claude workflow, and this repo doesn’t have it yet. The issue says how to add it.'
  } else if (fix.status === 'failed') {
    explain = 'The fix run stopped before it finished. Try again, or see the run.'
  }
  return {
    title: report.title,
    subtitle: report.statusLine,
    back: true,
    body: (
      <>
        {fix?.status === 'fixing' ? (
          <View style={styles.pair}>
            <ActivityIndicator color={colors.secondary} />
            <Text style={[text.footnote, styles.rowText, { color: colors.secondary }]}>
              Claude is reading the code and fixing it. It opens a PR with its own build to test,
              usually within a few minutes.
            </Text>
          </View>
        ) : null}
        {fix?.summary ? (
          <Text style={[text.subhead, { color: colors.label }]}>{fix.summary}</Text>
        ) : null}
        {explain ? (
          <Text style={[text.footnote, { color: colors.secondary }]}>{explain}</Text>
        ) : null}
        <LinkRow
          links={[
            fix?.prUrl ? { title: `PR #${fix.prNumber}`, url: fix.prUrl } : null,
            { title: `Issue #${report.issueNumber}`, url: report.issueUrl },
            fix?.runUrl ? { title: 'Workflow Run', url: fix.runUrl } : null,
          ]}
          colors={colors}
        />
      </>
    ),
    footer,
  }
}

/** Small text links in a row, e.g. the issue, the PR and the workflow run. */
function LinkRow({
  links,
  colors,
}: {
  links: ({ title: string; url: string } | null)[]
  colors: Colors
}) {
  const shown = links.filter((l): l is { title: string; url: string } => l !== null)
  if (!shown.length) return null
  return (
    <View style={styles.links}>
      {shown.map((link) => (
        <Pressable
          key={link.url}
          onPress={() => Linking.openURL(link.url)}
          accessibilityRole="link"
          hitSlop={8}
        >
          <Text style={[text.footnote, styles.rowTitle, { color: colors.tint }]}>{link.title}</Text>
        </Pressable>
      ))}
    </View>
  )
}

/**
 * Every step from sent to merged with its state, so it's always clear whether
 * the idea reached GitHub, what's running now, and where it stopped.
 */
function Timeline({ stages, colors }: { stages: IdeaStage[]; colors: Colors }) {
  return (
    <View style={styles.timeline} accessibilityRole="list">
      {stages.map((stage, i) => {
        const time = stage.state === 'done' ? stepTime(stage.at) : null
        const last = i === stages.length - 1
        return (
          <View
            key={stage.key}
            style={styles.stage}
            accessible
            accessibilityLabel={`${stage.title}: ${STATE_LABEL[stage.state]}${stage.detail ? `. ${stage.detail}` : ''}`}
          >
            <View style={styles.stageRail}>
              <StageMark state={stage.state} colors={colors} />
              {last ? null : (
                <View
                  style={[
                    styles.stageLine,
                    { backgroundColor: stage.state === 'done' ? colors.pass : colors.separator },
                  ]}
                />
              )}
            </View>
            <View style={[styles.rowText, !last && styles.stageGap]}>
              <View style={styles.stageHead}>
                <Text
                  style={[
                    text.subhead,
                    stage.state === 'waiting' ? null : styles.rowTitle,
                    { color: stage.state === 'waiting' ? colors.secondary : colors.label },
                  ]}
                >
                  {stage.title}
                </Text>
                {time ? (
                  <Text style={[text.footnote, { color: colors.secondary }]}>{time}</Text>
                ) : null}
              </View>
              {stage.detail ? (
                <Text
                  style={[
                    text.footnote,
                    { color: stage.state === 'failed' ? colors.fail : colors.secondary },
                  ]}
                >
                  {stage.detail}
                </Text>
              ) : null}
            </View>
          </View>
        )
      })}
    </View>
  )
}

const STATE_LABEL: Record<IdeaStage['state'], string> = {
  done: 'done',
  active: 'in progress',
  waiting: 'not started',
  failed: 'stopped',
}

function StageMark({ state, colors }: { state: IdeaStage['state']; colors: Colors }) {
  if (state === 'done') return <Mark kind="pass" colors={colors} size={20} />
  if (state === 'failed') return <Mark kind="fail" colors={colors} size={20} />
  if (state === 'active') {
    return (
      <View style={styles.stageDot}>
        <ActivityIndicator size="small" color={colors.tint} />
      </View>
    )
  }
  return <View style={[styles.stageDot, styles.stageHollow, { borderColor: colors.separator }]} />
}

/** One field per question; sending is enabled once every question has an answer. */
function IdeaAnswers({
  questions,
  busy,
  onSend,
  colors,
}: {
  questions: string[]
  busy: boolean
  onSend: (answers: string[]) => void
  colors: Colors
}) {
  const [answers, setAnswers] = useState<string[]>(() => questions.map(() => ''))
  const ready = answers.every((a) => a.trim() !== '')
  return (
    <View style={styles.sectionBlock}>
      {questions.map((question, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: questions are fixed for the round
        <View key={i} style={styles.question}>
          <Text style={[text.subhead, styles.rowTitle, { color: colors.label }]}>{question}</Text>
          <TextInput
            value={answers[i]}
            onChangeText={(value) =>
              setAnswers((current) => current.map((a, j) => (j === i ? value : a)))
            }
            placeholder="Your answer"
            placeholderTextColor={colors.secondary}
            multiline
            style={[
              text.subhead,
              styles.nameInput,
              { color: colors.label, backgroundColor: colors.fill },
            ]}
            accessibilityLabel={question}
          />
        </View>
      ))}
      <Capsule
        title="Send Answers"
        busy={busy}
        disabled={!ready}
        onPress={() => onSend(answers.map((a) => a.trim()))}
      />
    </View>
  )
}

/** After Claude stopped: one field to say how to go on, e.g. a smaller first version. */
function IdeaReply({
  busy,
  onSend,
  colors,
}: {
  busy: boolean
  onSend: (reply: string) => void
  colors: Colors
}) {
  const [reply, setReply] = useState('')
  return (
    <View style={styles.sectionBlock}>
      <View style={styles.question}>
        <Text style={[text.subhead, styles.rowTitle, { color: colors.label }]}>
          Tell Claude how to go on
        </Text>
        <Text style={[text.footnote, { color: colors.secondary }]}>
          For example, a smaller first version it can build now. Claude writes it up again for you
          to check before building.
        </Text>
        <TextInput
          value={reply}
          onChangeText={setReply}
          placeholder="Your reply"
          placeholderTextColor={colors.secondary}
          multiline
          style={[
            text.subhead,
            styles.nameInput,
            { color: colors.label, backgroundColor: colors.fill },
          ]}
          accessibilityLabel="Tell Claude how to go on"
        />
      </View>
      <Capsule
        title="Send to Claude"
        busy={busy}
        disabled={reply.trim() === ''}
        onPress={() => onSend(reply.trim())}
      />
    </View>
  )
}

function prsView(p: ReviewPopoverProps, colors: Colors): Screen {
  const { pulls } = p
  return {
    title: 'Switch PR',
    subtitle: pulls ? `${pulls.length} open with a preview` : 'Loading…',
    back: true,
    body: !pulls ? (
      <ActivityIndicator color={colors.secondary} />
    ) : pulls.length === 0 ? (
      <Text style={[text.subhead, { color: colors.secondary }]}>
        No other pull requests have a preview yet.
      </Text>
    ) : (
      pulls.map((pr) => <PullRow key={pr.number} pr={pr} p={p} colors={colors} />)
    ),
  }
}

/** The first failed step's position in a scenario, or -1. */
function firstFailed(scenario: ChecklistScenario, results: Results): number {
  return scenario.steps.findIndex((step) => results[stepId(scenario.key, step.index)] === 'fail')
}

/** A scenario not started opens its brief; one in progress opens its next step. */
function openScenario(scenario: ChecklistScenario, results: Results): Nav {
  const progress = scenarioProgress(scenario, results)
  if (progress.checked === 0) return { view: 'brief', key: scenario.key }
  const open = scenario.steps.findIndex((step) => !results[stepId(scenario.key, step.index)])
  return open >= 0
    ? { view: 'step', key: scenario.key, index: open }
    : { view: 'done', key: scenario.key }
}

function scenarioSubtitle(
  scenario: ChecklistScenario,
  progress: ScenarioProgress,
  canSetUp: boolean,
  walkthrough = false,
) {
  if (walkthrough) {
    // One look-over per screen, so no step counts.
    if (progress.state === 'failed') return 'Failed'
    if (progress.state === 'passed') return 'Passed'
    if (!scenario.setup?.length) return 'Not checked yet'
    return canSetUp ? 'Sets itself up' : 'Set up by hand'
  }
  const steps = `${progress.total} step${progress.total === 1 ? '' : 's'}`
  if (progress.state === 'new') {
    if (!scenario.setup?.length) return steps
    return `${steps} · ${canSetUp ? 'sets itself up' : 'set up by hand'}`
  }
  if (progress.state === 'partial') return `${progress.checked} of ${progress.total} checked`
  if (progress.state === 'failed') return `${progress.failed} failed`
  return 'All passed'
}

function briefView(p: ReviewPopoverProps, entry: Entry, colors: Colors): Screen {
  const steps = entry.scenario?.steps ?? []
  const lines = entry.setup ?? []
  const auto = p.canSetUp && lines.length > 0
  const manual = !auto && lines.length > 0
  return {
    title: entry.title,
    subtitle: entry.other
      ? 'Another state of the app'
      : p.checklist.walkthrough
        ? screenPosition(p.checklist, entry.key)
        : `${steps.length} step${steps.length === 1 ? '' : 's'}`,
    back: true,
    body: (
      <>
        {entry.why ? (
          <Text style={[text.subhead, { color: colors.label }]}>{entry.why}</Text>
        ) : null}
        {auto ? (
          <Section title="Tapthrough will" colors={colors}>
            {lines.map((line) => (
              <SetupRow key={line.auto} line={line} state="waiting" colors={colors} plain />
            ))}
          </Section>
        ) : null}
        {manual ? (
          <Section title="Set up by hand" colors={colors}>
            <Numbered items={lines.map((line) => ({ title: line.manual }))} colors={colors} />
          </Section>
        ) : null}
        {steps.length ? (
          <Section title="You’ll check" colors={colors}>
            <Numbered
              items={steps.map((s) => ({ title: s.action, detail: s.expect }))}
              colors={colors}
            />
          </Section>
        ) : null}
        {auto ? (
          <Text style={[text.caption, { color: colors.secondary }]}>
            This replaces the app’s local data and signs out whoever is signed in.
          </Text>
        ) : null}
      </>
    ),
    footer: auto ? (
      <>
        <Capsule
          title={entry.other ? 'Set Up' : 'Set Up and Start'}
          onPress={() => p.onSetUp(entry.key)}
        />
        <Capsule title="Skip Setup" kind="plain" onPress={() => p.onStart(entry.key)} />
      </>
    ) : (
      <Capsule title={entry.other ? 'Open Screen' : 'Start'} onPress={() => p.onStart(entry.key)} />
    ),
  }
}

function setupView(p: ReviewPopoverProps, entry: Entry, colors: Colors): Screen {
  const lines = entry.setup ?? []
  const setup = p.setup?.key === entry.key ? p.setup : null
  const error = setup?.error
  const states = setupLineStates(lines, setup?.progress ?? 'requesting')
  return {
    title: error ? 'Couldn’t set up' : 'Setting up',
    subtitle: entry.title,
    back: Boolean(error),
    body: (
      <>
        {lines.map((line, i) => (
          <SetupRow
            key={line.auto}
            line={line}
            state={error ? 'waiting' : (states[i] ?? 'waiting')}
            colors={colors}
          />
        ))}
        {error ? (
          <>
            <Text style={[text.subhead, { color: colors.fail }]} accessibilityRole="alert">
              {error}
            </Text>
            <Section title="Or set it up by hand" colors={colors}>
              <Numbered items={lines.map((line) => ({ title: line.manual }))} colors={colors} />
            </Section>
          </>
        ) : null}
      </>
    ),
    footer: error ? (
      <>
        <Capsule title="Try Again" onPress={() => p.onSetUp(entry.key)} />
        <Capsule title="Continue Without Setup" kind="plain" onPress={() => p.onStart(entry.key)} />
      </>
    ) : undefined,
  }
}

function stepView(
  p: ReviewPopoverProps,
  entry: Entry,
  scenario: ChecklistScenario,
  index: number,
  colors: Colors,
): Screen {
  const step = scenario.steps[index]
  if (!step) return listView(p, colors)
  const result = p.results[stepId(scenario.key, step.index)]
  return {
    title: entry.title,
    subtitle: p.checklist.walkthrough
      ? screenPosition(p.checklist, scenario.key)
      : `Step ${index + 1} of ${scenario.steps.length}`,
    back: true,
    body: (
      <>
        <Text style={[text.headline, { color: colors.label }]}>{step.action}</Text>
        <Text style={[text.subhead, { color: colors.secondary }]}>Expect: {step.expect}</Text>
        {result === 'fail' && !step.result?.carriedFrom ? (
          <Text style={[text.footnote, { color: colors.secondary }]}>
            You failed this step. If it works now, tap Pass: the PR shows the newest result.
          </Text>
        ) : null}
        {step.result?.carriedFrom && result === step.result.result ? (
          <Text style={[text.footnote, { color: colors.secondary }]}>
            {`${step.result.result === 'pass' ? 'Passed' : step.result.result === 'fail' ? 'Failed' : 'Skipped'} on ${step.result.carriedFrom.slice(0, 7)}. Kept because later pushes didn’t change this screen.`}
          </Text>
        ) : null}
      </>
    ),
    footer: (
      <View style={styles.pair}>
        <Capsule
          title="Fail"
          kind="gray"
          icon="xmark"
          iconColor={colors.fail}
          fillColor={result === 'fail' ? colors.fail : undefined}
          accessibilityLabel={`Fail: ${step.action}`}
          onPress={() => p.onFail(scenario.key, index)}
          style={styles.half}
        />
        <Capsule
          title="Pass"
          kind="gray"
          icon="checkmark"
          iconColor={colors.pass}
          fillColor={result === 'pass' ? colors.pass : undefined}
          accessibilityLabel={`Pass: ${step.action}`}
          onPress={() => p.onPass(scenario.key, index)}
          style={styles.half}
        />
      </View>
    ),
  }
}

function recheckView(p: ReviewPopoverProps, item: RecheckItem, colors: Colors): Screen {
  const done = p.rechecked[item.id] ?? (item.stillBrokenHere ? 'still_broken' : undefined)
  return {
    title: 'Re-check',
    subtitle: reportedBy(item),
    back: true,
    body: (
      <>
        <Text style={[text.headline, { color: colors.label }]}>{item.excerpt}</Text>
        <Text style={[text.subhead, { color: colors.secondary }]}>
          Try it again on this build. Is it fixed?
        </Text>
      </>
    ),
    footer: (
      <View style={styles.pair}>
        <Capsule
          title="Still Broken"
          kind="gray"
          icon="xmark"
          iconColor={colors.fail}
          fillColor={done === 'still_broken' ? colors.fail : undefined}
          onPress={() => p.onRecheck(item, 'still_broken')}
          style={styles.half}
        />
        <Capsule
          title="Fixed"
          kind="gray"
          icon="checkmark"
          iconColor={colors.pass}
          fillColor={done === 'fixed' ? colors.pass : undefined}
          onPress={() => p.onRecheck(item, 'fixed')}
          style={styles.half}
        />
      </View>
    ),
  }
}

function doneView(p: ReviewPopoverProps, entry: Entry, colors: Colors): Screen {
  const scenario = entry.scenario
  const progress = scenario ? scenarioProgress(scenario, p.results) : null
  const next = nextOpenScenario(p.checklist, p.results, entry.key)
  const failedAt = scenario ? firstFailed(scenario, p.results) : -1
  const onward = next ? (
    <Capsule
      title={`Next: ${next.title}`}
      kind={failedAt >= 0 ? 'plain' : undefined}
      onPress={() => p.onNav(openScenario(next, p.results), 'forward')}
    />
  ) : (
    <Capsule
      title="Finish Review"
      kind={failedAt >= 0 ? 'plain' : undefined}
      onPress={() => p.onNav({ view: 'list' }, 'back')}
    />
  )
  return {
    title: entry.title,
    subtitle: 'Checked',
    back: true,
    body: (
      <>
        <View style={styles.done}>
          <Mark kind={progress?.failed ? 'fail' : 'pass'} colors={colors} size={52} />
          <Text style={[text.title2, { color: colors.label }]}>
            {progress?.failed ? `${progress.failed} failed` : 'All passed'}
          </Text>
          {progress ? (
            <Text style={[text.subhead, { color: colors.secondary }]}>
              {`${progress.passed} of ${progress.total} passed`}
            </Text>
          ) : null}
        </View>
        {scenario?.steps.map((step, index) => {
          const result = p.results[stepId(scenario.key, step.index)]
          return (
            <Row
              key={step.index}
              colors={colors}
              lead={
                result === 'pass' || result === 'fail' ? (
                  <Mark kind={result} colors={colors} />
                ) : (
                  <Badge icon="arrow.right" colors={colors} />
                )
              }
              title={step.action}
              subtitle={
                result === 'fail'
                  ? 'Failed · tap to check it again'
                  : result === 'pass'
                    ? 'Passed'
                    : 'Not checked'
              }
              onPress={() => p.onNav({ view: 'step', key: scenario.key, index }, 'forward')}
            />
          )
        })}
      </>
    ),
    footer: (
      <>
        {scenario && failedAt >= 0 ? (
          <Capsule
            title="Check Failed Step Again"
            onPress={() => p.onNav({ view: 'step', key: scenario.key, index: failedAt }, 'forward')}
          />
        ) : null}
        {onward}
      </>
    ),
  }
}

function reportedBy(item: RecheckItem) {
  return [item.reporter, `reported on ${item.sha.slice(0, 7)}`].filter(Boolean).join(' · ')
}

function Row({
  lead,
  title,
  subtitle,
  onPress,
  colors,
}: {
  lead: ReactNode
  title: string
  subtitle: string
  onPress: () => void
  colors: Colors
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${subtitle}`}
      style={({ pressed }) => [styles.row, pressed && { backgroundColor: colors.fill }]}
    >
      {lead}
      <View style={styles.rowText}>
        <Text style={[text.subhead, styles.rowTitle, { color: colors.label }]} numberOfLines={2}>
          {title}
        </Text>
        <Text style={[text.footnote, { color: colors.secondary }]} numberOfLines={1}>
          {subtitle}
        </Text>
      </View>
      <Icon name="chevron.right" size={13} color={colors.tertiary} />
    </Pressable>
  )
}

function ResetRow({ reset, colors }: { reset: ChecklistReset; colors: Colors }) {
  return (
    <View style={[styles.newer, { backgroundColor: colors.fill }]}>
      <Icon name="arrow.clockwise" size={20} color={colors.secondary} />
      <View style={styles.rowText}>
        <Text style={[text.subhead, styles.rowTitle, { color: colors.label }]}>
          Checklist reset for this build
        </Text>
        <Text style={[text.footnote, { color: colors.secondary }]}>{resetMessage(reset)}</Text>
      </View>
    </View>
  )
}

function NewerRow({ build, colors }: { build: NewerBuild; colors: Colors }) {
  return (
    <View style={[styles.newer, { backgroundColor: colors.fill }]}>
      <Icon name="arrow.down.circle.fill" size={26} color={colors.tint} />
      <View style={styles.rowText}>
        <Text style={[text.subhead, styles.rowTitle, { color: colors.label }]}>
          {build.hasFix ? 'Claude pushed a fix' : 'A newer build is ready'}
        </Text>
        <Text style={[text.footnote, { color: colors.secondary }]}>
          {`${build.sha.slice(0, 7)} · you’re on an older build`}
        </Text>
      </View>
      {build.openUrl ? (
        <Pressable
          onPress={() => Linking.openURL(build.openUrl as string)}
          accessibilityRole="link"
          accessibilityLabel="Open the newer build"
          style={({ pressed }) => [
            styles.pill,
            { backgroundColor: colors.tintFill },
            pressed && styles.pressed,
          ]}
        >
          <Text style={[text.subhead, styles.rowTitle, { color: colors.tint }]}>Open</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

function Mark({
  kind,
  colors,
  size = 26,
}: {
  kind: 'pass' | 'fail'
  colors: Colors
  size?: number
}) {
  return (
    <View
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: size / 2 },
        { backgroundColor: kind === 'pass' ? colors.pass : colors.fail },
      ]}
    >
      <Icon
        name={kind === 'pass' ? 'checkmark' : 'xmark'}
        size={size * 0.45}
        color="#FFFFFF"
        weight="bold"
      />
    </View>
  )
}

function Badge({
  icon,
  colors,
  attention = false,
}: {
  icon: IconName
  colors: Colors
  /** Adds the tape-colored dot: something here waits on you. */
  attention?: boolean
}) {
  return (
    <View style={[styles.mark, { backgroundColor: colors.tintFill }]}>
      <Icon name={icon} size={13} color={colors.tint} />
      {attention ? <View style={styles.attention} /> : null}
    </View>
  )
}

function ProgressMark({ progress, colors }: { progress: ScenarioProgress; colors: Colors }) {
  if (progress.state === 'passed') return <Mark kind="pass" colors={colors} />
  if (progress.state === 'failed') return <Mark kind="fail" colors={colors} />
  const started = progress.state === 'partial'
  return (
    <View
      style={[styles.mark, styles.ring, { borderColor: started ? colors.tint : colors.tertiary }]}
    >
      {started ? (
        <Text style={[styles.ringText, { color: colors.tint }]} allowFontScaling={false}>
          {progress.checked}
        </Text>
      ) : null}
    </View>
  )
}

const LINE_ICON: Record<SetupLine['kind'], IconName> = {
  account: 'person.fill',
  data: 'tray.full.fill',
  flag: 'flag.fill',
  screen: 'arrow.right',
}

function SetupRow({
  line,
  state,
  colors,
  plain = false,
}: {
  line: SetupLine
  state: 'waiting' | 'active' | 'done'
  colors: Colors
  /** In the brief: just the icon, no progress. */
  plain?: boolean
}) {
  return (
    <View style={[styles.setupRow, !plain && state === 'waiting' && styles.waiting]}>
      <View
        style={[
          styles.mark,
          {
            backgroundColor:
              !plain && state === 'done' ? colors.pass : plain ? colors.tintFill : colors.fill,
          },
        ]}
      >
        {!plain && state === 'active' ? (
          <ActivityIndicator size="small" />
        ) : !plain && state === 'done' ? (
          <Icon name="checkmark" size={12} color="#FFFFFF" weight="bold" />
        ) : (
          <Icon
            name={LINE_ICON[line.kind]}
            size={12}
            color={plain ? colors.tint : colors.secondary}
          />
        )}
      </View>
      <Text style={[text.subhead, styles.rowText, { color: colors.label }]}>{line.auto}</Text>
    </View>
  )
}

function Section({
  title,
  colors,
  children,
}: {
  title: string
  colors: Colors
  children: ReactNode
}) {
  return (
    <View style={styles.sectionBlock}>
      <Text style={[text.footnote, styles.sectionTitle, { color: colors.secondary }]}>{title}</Text>
      {children}
    </View>
  )
}

function Numbered({
  items,
  colors,
}: {
  items: { title: string; detail?: string }[]
  colors: Colors
}) {
  return (
    <View style={styles.numbered}>
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list; the number is part of the content
        <View key={`${i}:${item.title}`} style={styles.numberedRow}>
          <Text
            style={[text.subhead, styles.number, { color: colors.secondary }]}
          >{`${i + 1}.`}</Text>
          <View style={styles.rowText}>
            <Text style={[text.subhead, { color: colors.label }]}>{item.title}</Text>
            {item.detail ? (
              <Text style={[text.footnote, { color: colors.secondary }]}>{item.detail}</Text>
            ) : null}
          </View>
        </View>
      ))}
    </View>
  )
}

/** Who's reviewing: a slim line once known, a field until then. Shown on the PR. */
export function ReviewerName({
  name,
  onChange,
  colors,
}: {
  name: string
  onChange: (name: string) => void
  colors: Colors
}) {
  const [editing, setEditing] = useState(name.trim() === '')
  if (!editing) {
    return (
      <View style={styles.nameRow}>
        <Text style={[text.footnote, { color: colors.secondary }]}>
          Reviewing as <Text style={{ color: colors.label, fontWeight: '600' }}>{name.trim()}</Text>
        </Text>
        <Pressable onPress={() => setEditing(true)} accessibilityRole="button" hitSlop={12}>
          <Text style={[text.footnote, styles.rowTitle, { color: colors.tint }]}>Change</Text>
        </Pressable>
      </View>
    )
  }
  return (
    <TextInput
      value={name}
      onChangeText={onChange}
      onBlur={() => setEditing(name.trim() === '')}
      placeholder="Your name (shown on the PR)"
      placeholderTextColor={colors.secondary}
      autoCapitalize="words"
      returnKeyType="done"
      style={[
        text.subhead,
        styles.nameInput,
        { color: colors.label, backgroundColor: colors.fill },
      ]}
      accessibilityLabel="Your name"
    />
  )
}

const styles = StyleSheet.create({
  frame: { position: 'absolute' },
  surface: { padding: 8, flexShrink: 1 },
  grow: { flex: 1 },
  column: { flexShrink: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingBottom: 6 },
  headerText: { flex: 1, minWidth: 0 },
  headerTextAlone: { paddingLeft: 10 },
  scroll: { flexGrow: 0, flexShrink: 1 },
  body: { paddingHorizontal: 10, paddingTop: 4, paddingBottom: 10, gap: 10 },
  footer: { gap: 2, paddingTop: 4 },
  footerFull: { paddingBottom: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 9,
    paddingHorizontal: 10,
    marginHorizontal: -10,
    borderRadius: 22,
  },
  rowText: { flex: 1, minWidth: 0 },
  rowTitle: { fontWeight: '600' },
  section: { fontWeight: '600', marginTop: 8 },
  sectionBlock: { gap: 8, marginTop: 4 },
  sectionTitle: { fontWeight: '600' },
  newer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 22,
    marginHorizontal: -4,
  },
  pill: { paddingVertical: 6, paddingHorizontal: 16, borderRadius: 999 },
  pressed: { opacity: 0.7 },
  mark: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  ring: { borderWidth: 2, backgroundColor: 'transparent' },
  ringText: { fontSize: 11, fontWeight: '700' },
  setupRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  waiting: { opacity: 0.45 },
  numbered: { gap: 8 },
  numberedRow: { flexDirection: 'row', gap: 8 },
  number: { width: 20, fontWeight: '600', fontVariant: ['tabular-nums'] },
  pair: { flexDirection: 'row', gap: 8 },
  half: { flex: 1 },
  done: { alignItems: 'center', gap: 4, paddingVertical: 10 },
  nameRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 6,
  },
  nameInput: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, marginTop: 6 },
  question: { gap: 2 },
  links: { flexDirection: 'row', flexWrap: 'wrap', gap: 14, marginTop: 4 },
  timeline: { marginTop: 2 },
  stage: { flexDirection: 'row', gap: 10 },
  stageRail: { width: 20, alignItems: 'center' },
  stageLine: { width: 2, flex: 1, marginVertical: 2, borderRadius: 1 },
  stageGap: { paddingBottom: 12 },
  stageHead: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  stageDot: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  stageHollow: { borderWidth: 2, borderRadius: 10, width: 16, height: 16, margin: 2 },
  attention: {
    position: 'absolute',
    top: -1,
    right: -1,
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: '#ecd88e',
  },
})
