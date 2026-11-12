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
  ChecklistScenario,
  NewerBuild,
  RecheckItem,
  SetupLine,
} from './core/feedback.js'
import {
  nextOpenScenario,
  otherStates,
  type Placement,
  type Results,
  type ScenarioProgress,
  type SetupProgress,
  scenarioProgress,
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
  | { view: 'explore'; key: string }
  | { view: 'recheck'; id: string }

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
  nav.view === 'list'
    ? 'list'
    : nav.view === 'recheck'
      ? `recheck:${nav.id}`
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
    case 'explore':
      return exploreView(p, entry, colors)
  }
}

/* ---------------------------------- views --------------------------------- */

function listView(p: ReviewPopoverProps, colors: Colors): Screen {
  const { checklist, results } = p
  const scenarios = checklist.scenarios.filter((s) => s.steps.length > 0)
  const recheck = checklist.recheck ?? []
  const others = otherStates(checklist)
  const counts = [
    scenarios.length ? `${scenarios.length} to test` : null,
    recheck.length ? `${recheck.length} to re-check` : null,
  ].filter(Boolean)
  return {
    title: `PR #${checklist.pr}`,
    subtitle: counts.join(' · ') || 'Nothing planned for this PR',
    body: (
      <>
        {checklist.newerBuild ? <NewerRow build={checklist.newerBuild} colors={colors} /> : null}
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
        {others.length ? (
          <>
            <Text style={[text.footnote, styles.section, { color: colors.secondary }]}>
              Other states
            </Text>
            {others.map((state) => (
              <Row
                key={state.key}
                colors={colors}
                lead={<Badge icon="arrow.right.circle" colors={colors} />}
                title={state.title}
                subtitle={
                  plain(state.why) ??
                  (p.canSetUp && state.setup?.length ? 'Sets itself up' : 'Look around')
                }
                onPress={() => p.onNav({ view: 'brief', key: state.key }, 'forward')}
              />
            ))}
          </>
        ) : null}
        <ReviewerName name={p.name} onChange={p.onNameChange} colors={colors} />
      </>
    ),
    footer: <Capsule title="Report Something Else" kind="plain" onPress={p.onReportOther} />,
  }
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
) {
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
      <Capsule
        title={manual ? 'I’m Ready' : entry.other ? 'Look Around' : 'Start'}
        onPress={() => p.onStart(entry.key)}
      />
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
    subtitle: `Step ${index + 1} of ${scenario.steps.length}`,
    back: true,
    body: (
      <>
        <Text style={[text.headline, { color: colors.label }]}>{step.action}</Text>
        <Text style={[text.subhead, { color: colors.secondary }]}>Expect: {step.expect}</Text>
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
  const progress = entry.scenario ? scenarioProgress(entry.scenario, p.results) : null
  const next = nextOpenScenario(p.checklist, p.results, entry.key)
  return {
    title: entry.title,
    subtitle: 'Checked',
    back: true,
    body: (
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
    ),
    footer: (
      <>
        {next ? (
          <Capsule
            title={`Next: ${next.title}`}
            onPress={() => p.onNav(openScenario(next, p.results), 'forward')}
          />
        ) : (
          <Capsule title="All Done" onPress={p.onClose} />
        )}
        <Capsule
          title="Back to List"
          kind="plain"
          onPress={() => p.onNav({ view: 'list' }, 'back')}
        />
      </>
    ),
  }
}

function exploreView(p: ReviewPopoverProps, entry: Entry, colors: Colors): Screen {
  return {
    title: entry.title,
    subtitle: 'Ready to look around',
    back: true,
    body: (
      <Text style={[text.subhead, { color: colors.label }]}>
        The app is in this state now. Look around, and report anything that seems off.
      </Text>
    ),
    footer: (
      <>
        <Capsule title="Report Something" onPress={p.onReportOther} />
        <Capsule
          title="Back to List"
          kind="plain"
          onPress={() => p.onNav({ view: 'list' }, 'back')}
        />
      </>
    ),
  }
}

/* --------------------------------- pieces --------------------------------- */

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

function Badge({ icon, colors }: { icon: IconName; colors: Colors }) {
  return (
    <View style={[styles.mark, { backgroundColor: colors.tintFill }]}>
      <Icon name={icon} size={13} color={colors.tint} />
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
})
