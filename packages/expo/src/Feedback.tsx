import Constants from 'expo-constants'
import { usePathname } from 'expo-router'
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Animated,
  AppState,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native'
import { Annotator } from './Annotator.js'
import { Bubble, COLORS, screenBounds } from './Bubble.js'
import type { AnnotationBox } from './core/annotations.js'
import { defaultPosition, type Point } from './core/bubble.js'
import { createDiagnostics, installDiagnostics } from './core/diagnostics.js'
import {
  type Checklist,
  type ChecklistStep,
  failedStepBody,
  fetchChecklist,
  hasReviewItems,
  type NewerBuild,
  previewContextFromManifest,
  type RecheckItem,
  requestFix,
  requestLaunch,
  reviewBadge,
  sendCause,
  sendFeedback,
  sendRecheck,
  sendStepResult,
  type Triage,
} from './core/feedback.js'
import { nextOpenStep, popoverPlacement, type Results, resultsFrom, stepId } from './core/review.js'
import { useLaunchState } from './hooks.js'
import { Overlay, useBackPress } from './Overlay.js'
import {
  type Direction,
  type Nav,
  ReviewerName,
  ReviewPopover,
  type SetupStatus,
} from './Popover.js'
import { controller } from './runtime.js'
import { captureScreenshot, type Screenshot } from './screenshot.js'
import { haptics, useReduceMotion } from './ui/native.js'
import { Capsule, CircleButton, Icon, Surface } from './ui/parts.js'
import { SPRING, text, useColors } from './ui/theme.js'

/** Remembered for the session, so reviewers type their name once. */
let rememberedName = ''

const diagnostics = createDiagnostics()
let diagnosticsInstalled = false

declare const ErrorUtils:
  | {
      getGlobalHandler(): (error: unknown, isFatal?: boolean) => void
      setGlobalHandler(handler: (error: unknown, isFatal?: boolean) => void): void
    }
  | undefined

function deviceInfo() {
  const constants = Platform.constants as unknown as Record<string, unknown>
  if (Platform.OS === 'ios') {
    return {
      os: 'iOS',
      osVersion: String(Platform.Version),
      model: constants.interfaceIdiom === 'pad' ? 'iPad' : 'iPhone',
    }
  }
  const model = [constants.Manufacturer, constants.Model].filter(Boolean).join(' ')
  return {
    os: 'Android',
    osVersion: String(constants.Release ?? Platform.Version),
    ...(model ? { model } : {}),
  }
}

/** e.g. "iPhone · iOS 26.1", for the composer's list of what's attached. */
function deviceLabel() {
  const { os, osVersion, model } = deviceInfo()
  return `${model ?? os} · ${os} ${osVersion}`
}

function nextFrame() {
  return new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
}

/**
 * Puts the app's keyboard away. A sheet that opens while it's up can't tell
 * it's there, so the bottom of the sheet would sit under it. Resolves once it's
 * gone, so a screenshot taken next doesn't catch it halfway down.
 */
function dismissKeyboard() {
  if (!Keyboard.isVisible()) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = () => {
      subscription.remove()
      clearTimeout(fallback)
      resolve()
    }
    const subscription = Keyboard.addListener('keyboardDidHide', done)
    // In case the event never comes, e.g. a hardware keyboard.
    const fallback = setTimeout(done, 500)
    Keyboard.dismiss()
  })
}

interface FailingStep {
  scenarioKey: string
  step: ChecklistStep
  /** The step's position in the scenario, for moving on once the report is sent. */
  position: number
}

/** How often a PR preview checks for new results and newer builds while in the foreground. */
const REFRESH_MS = 30_000

/** Update groups the reviewer has already been told about, so the toast shows once. */
const announcedBuilds = new Set<string>()

type Phase = 'idle' | 'loading' | 'open' | 'capturing' | 'composing'

/**
 * A small draggable Review button over a PR preview. Tapping it grows a
 * popover listing what the PR needs tested; picking a scenario can set the app
 * up for it and then walks through its steps. Without a plan it goes straight
 * to reporting an issue with a screenshot of the screen behind it. It keeps
 * the checklist fresh in the background, so it can say when a newer build is out.
 */
export function ReportButton({ apiUrl, canSetUp }: { apiUrl: string; canSetUp: boolean }) {
  const preview = useMemo(() => previewContextFromManifest(Constants.manifest2), [])
  const pathname = usePathname()
  const { width, height } = useWindowDimensions()
  const bounds = screenBounds(width, height)
  const [phase, setPhase] = useState<Phase>('idle')
  const [checklist, setChecklist] = useState<Checklist | null>(null)
  const [nav, setNav] = useState<Nav>({ view: 'list' })
  const [direction, setDirection] = useState<Direction>('forward')
  const [full, setFull] = useState(false)
  const [overrides, setOverrides] = useState<Results>({})
  const [rechecked, setRechecked] = useState<Record<string, 'fixed' | 'still_broken'>>({})
  const [setup, setSetup] = useState<SetupStatus | null>(null)
  const [anchor, setAnchor] = useState<Point | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [name, setName] = useState(rememberedName)
  const [failing, setFailing] = useState<FailingStep | null>(null)
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null)
  const [toast, setToast] = useState<NewerBuild | null>(null)
  const launch = useLaunchState()
  const platform = Platform.OS === 'ios' || Platform.OS === 'android' ? Platform.OS : null
  const results = useMemo(
    () => ({ ...resultsFrom(checklist), ...overrides }),
    [checklist, overrides],
  )

  // Only PR previews record diagnostics; regular builds are never hooked.
  useEffect(() => {
    if (!preview || diagnosticsInstalled) return
    diagnosticsInstalled = true
    installDiagnostics(
      diagnostics,
      {
        console,
        errorUtils: typeof ErrorUtils === 'undefined' ? undefined : ErrorUtils,
        fetchHost: globalThis,
      },
      apiUrl,
    )
  }, [preview, apiUrl])

  useEffect(() => {
    if (preview) diagnostics.recordScreen(pathname)
  }, [preview, pathname])

  async function refresh() {
    if (!preview || !platform) return null
    const list = await fetchChecklist(preview, platform, { apiUrl })
    if (list) setChecklist(list)
    const newer = list?.newerBuild
    if (newer && !announcedBuilds.has(newer.updateGroupId)) {
      announcedBuilds.add(newer.updateGroupId)
      setToast(newer)
    }
    return list
  }

  // Fetch up front so the popover opens instantly, then poll while the app is in front.
  // biome-ignore lint/correctness/useExhaustiveDependencies: refresh reads current props
  useEffect(() => {
    if (!preview || !platform) return
    let timer: ReturnType<typeof setInterval> | undefined
    const start = () => {
      clearInterval(timer)
      void refresh()
      timer = setInterval(() => void refresh(), REFRESH_MS)
    }
    const stop = () => clearInterval(timer)
    if (AppState.currentState === 'active') start()
    const subscription = AppState.addEventListener('change', (next) =>
      next === 'active' ? start() : stop(),
    )
    return () => {
      stop()
      subscription.remove()
    }
  }, [preview, platform, apiUrl])

  useEffect(() => {
    if (!toast) return
    const timer = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(timer)
  }, [toast])

  // A setup this popover started: follow the launch through its stages.
  useEffect(() => {
    if (!setup || setup.error || setup.progress === 'done') return
    if (launch.status === 'idle' || launch.source !== 'app') return
    if (launch.status === 'launching') {
      if (launch.stage && launch.stage !== setup.progress) {
        setSetup({ ...setup, progress: launch.stage })
      }
      return
    }
    controller.dismiss()
    if (launch.status === 'error') {
      haptics.warning()
      setSetup({ ...setup, error: launch.error.message })
      return
    }
    haptics.success()
    setSetup({ ...setup, progress: 'done' })
  }, [launch, setup])

  // Once every line is ticked, let it show for a moment, then start the steps.
  // biome-ignore lint/correctness/useExhaustiveDependencies: begin reads the current checklist
  useEffect(() => {
    if (setup?.progress !== 'done' || setup.error) return
    const key = setup.key
    const timer = setTimeout(() => {
      setSetup(null)
      begin(key)
      void refresh()
    }, 700)
    return () => clearTimeout(timer)
  }, [setup])

  if (!preview || !platform) return null

  function go(next: Nav, dir: Direction = 'forward') {
    setDirection(dir)
    setNav(next)
    setError(null)
  }

  function rememberName() {
    rememberedName = name.trim()
  }

  /** Starts a scenario's steps where they're left off, or explores another state. */
  function begin(key: string) {
    const scenario = checklist?.scenarios.find((s) => s.key === key)
    if (!scenario?.steps.length) {
      go({ view: 'explore', key })
      return
    }
    const index = nextOpenStep(scenario, results)
    go(index >= 0 ? { view: 'step', key, index } : { view: 'done', key })
  }

  async function setUp(key: string) {
    if (!preview || !platform) return
    haptics.selection()
    controller.dismiss()
    go({ view: 'setup', key })
    setSetup({ key, progress: 'requesting' })
    const result = await requestLaunch({ preview, platform, scenarioKey: key }, { apiUrl })
    if (!result.ok) {
      haptics.warning()
      setSetup({ key, progress: 'requesting', error: result.message })
      return
    }
    if (!controller.offer(result.launchUrl, 'app')) {
      setSetup({
        key,
        progress: 'requesting',
        error: 'That setup link was already used. Try again.',
      })
    }
  }

  async function pass(key: string, index: number) {
    const scenario = checklist?.scenarios.find((s) => s.key === key)
    const step = scenario?.steps[index]
    if (!preview || !platform || !scenario || !step) return
    rememberName()
    haptics.selection()
    const id = stepId(key, step.index)
    const previous = results[id]
    const after: Results = { ...results, [id]: 'pass' }
    setOverrides((current) => ({ ...current, [id]: 'pass' }))
    // Let the green show, then slide in the next step.
    setTimeout(() => {
      const next = nextOpenStep(scenario, after, index + 1)
      go(next >= 0 ? { view: 'step', key, index: next } : { view: 'done', key })
      if (next < 0) haptics.success()
    }, 280)
    const sent = await sendStepResult(
      {
        preview,
        platform,
        scenarioKey: key,
        stepIndex: step.index,
        result: 'pass',
        ...(rememberedName ? { reporterName: rememberedName } : {}),
      },
      { apiUrl },
    )
    if (!sent.ok) {
      setOverrides((current) => ({ ...current, [id]: previous }))
      setError(sent.message)
    }
  }

  function fail(key: string, index: number) {
    const step = checklist?.scenarios.find((s) => s.key === key)?.steps[index]
    if (!step) return
    rememberName()
    haptics.warning()
    void startReport({ scenarioKey: key, step, position: index })
  }

  async function recheck(item: RecheckItem, result: 'fixed' | 'still_broken') {
    if (!preview || !platform) return
    rememberName()
    haptics.selection()
    setRechecked((current) => ({ ...current, [item.id]: result }))
    setTimeout(() => go({ view: 'list' }, 'back'), 350)
    const sent = await sendRecheck(
      {
        preview,
        platform,
        findingId: item.id,
        result,
        ...(rememberedName ? { reporterName: rememberedName } : {}),
      },
      { apiUrl },
    )
    if (!sent.ok) {
      setRechecked(({ [item.id]: _, ...rest }) => rest)
      setError(sent.message)
    }
  }

  async function toggle() {
    if (phase === 'open') {
      close()
      return
    }
    setToast(null)
    const keyboardGone = dismissKeyboard()
    // A setup that finished or failed while closed shouldn't leave a spinner behind.
    if (nav.view === 'setup' && !setup) setNav({ view: 'list' })
    if (hasReviewItems(checklist)) {
      setPhase('open')
      void refresh()
      return
    }
    setPhase('loading')
    const list = await refresh()
    if (hasReviewItems(list)) {
      setPhase('open')
    } else {
      await keyboardGone
      await startReport(null)
    }
  }

  function close() {
    setPhase('idle')
    setFull(false)
    setError(null)
  }

  /** Hides everything, screenshots the app, then opens the composer. */
  async function startReport(step: FailingStep | null) {
    setFailing(step)
    setToast(null)
    setPhase('capturing')
    try {
      await nextFrame()
      setScreenshot(await captureScreenshot())
    } finally {
      // Whatever happens to the screenshot, the reviewer gets the composer.
      setPhase('composing')
    }
  }

  /** Back from the composer without sending: to the popover if that's where it started. */
  function cancelReport() {
    setScreenshot(null)
    setFailing(null)
    setPhase(hasReviewItems(checklist) ? 'open' : 'idle')
  }

  /** After a report is sent: a failed step moves the plan on; the next tap carries on there. */
  function finishReport() {
    if (failing) {
      const scenario = checklist?.scenarios.find((s) => s.key === failing.scenarioKey)
      const id = stepId(failing.scenarioKey, failing.step.index)
      const after: Results = { ...results, [id]: 'fail' }
      setOverrides((current) => ({ ...current, [id]: 'fail' }))
      if (scenario) {
        const next = nextOpenStep(scenario, after, failing.position + 1)
        go(
          next >= 0
            ? { view: 'step', key: scenario.key, index: next }
            : { view: 'done', key: scenario.key },
        )
      }
    }
    setScreenshot(null)
    setFailing(null)
    setPhase('idle')
    void refresh()
  }

  const placement = popoverPlacement(anchor ?? defaultPosition(bounds), bounds)
  const showButton = phase === 'idle' || phase === 'loading' || (phase === 'open' && !full)

  return (
    <Overlay>
      {toast && phase !== 'open' && phase !== 'composing' && phase !== 'capturing' ? (
        <NewBuildToast build={toast} onPress={toggle} />
      ) : null}
      {phase === 'open' && checklist ? (
        <ReviewPopover
          checklist={checklist}
          results={results}
          rechecked={rechecked}
          nav={nav}
          direction={direction}
          onNav={(next, dir) => {
            haptics.selection()
            go(next, dir)
          }}
          placement={placement}
          bounds={bounds}
          full={full}
          onToggleFull={() => {
            haptics.light()
            setFull((current) => !current)
          }}
          onClose={close}
          canSetUp={canSetUp}
          setup={setup}
          onSetUp={setUp}
          onStart={(key) => {
            haptics.selection()
            setSetup(null)
            begin(key)
          }}
          onPass={pass}
          onFail={fail}
          onRecheck={recheck}
          onReportOther={() => void startReport(null)}
          name={name}
          onNameChange={(next) => {
            setName(next)
            rememberedName = next.trim()
          }}
          error={error}
        />
      ) : null}
      {showButton ? (
        <Bubble
          onPress={toggle}
          badge={reviewBadge(checklist)}
          busy={phase === 'loading'}
          active={phase === 'open'}
          onRest={setAnchor}
        />
      ) : null}
      {phase === 'composing' && screenshot ? <CaptureFlash /> : null}
      {phase === 'composing' ? (
        <Composer
          screenshot={screenshot}
          route={pathname}
          branch={preview.branch}
          device={deviceLabel()}
          hasScenario={Boolean(controller.lastScenarioId())}
          failedStep={failing?.step ?? null}
          onSend={async (input) => {
            const result = await sendFeedback(
              {
                ...input,
                body: failing ? failedStepBody(failing.step, input.body) : input.body,
                // A failed step in the PR's own plan is the PR's to fix.
                ...(failing ? { cause: 'pr' as const } : {}),
                preview,
                platform,
                route: pathname,
                device: deviceInfo(),
                diagnostics: diagnostics.snapshot(),
                ...(controller.lastScenarioId() ? { scenarioId: controller.lastScenarioId() } : {}),
              },
              { apiUrl },
            )
            if (result.ok && failing) {
              await sendStepResult(
                {
                  preview,
                  platform,
                  scenarioKey: failing.scenarioKey,
                  stepIndex: failing.step.index,
                  result: 'fail',
                  ...(input.reporterName ? { reporterName: input.reporterName } : {}),
                  ...(result.findingId ? { findingId: result.findingId } : {}),
                },
                { apiUrl },
              )
            }
            return result
          }}
          onSetCause={(findingId, cause) =>
            sendCause({ preview, platform, findingId, cause }, { apiUrl })
          }
          onRequestFix={(findingId) =>
            requestFix(
              {
                preview,
                platform,
                findingId,
                ...(rememberedName ? { reporterName: rememberedName } : {}),
              },
              { apiUrl },
            )
          }
          onCancel={cancelReport}
          onClose={finishReport}
        />
      ) : null}
    </Overlay>
  )
}

/**
 * A floating glass sheet that rises from the bottom edge and sits above the
 * keyboard. It's a plain view in the overlay rather than a Modal, because on
 * iOS a Modal can't present while the app is already showing a native modal
 * screen. With `scrim`, the app behind dims and a tap on it closes the sheet.
 */
function Sheet({
  onClose,
  scrim = false,
  children,
}: {
  onClose: () => void
  /** Dims the app behind, and a tap on it closes the sheet. */
  scrim?: boolean
  children: ReactNode
}) {
  const { height } = useWindowDimensions()
  const reduceMotion = useReduceMotion()
  const shown = useRef(new Animated.Value(0)).current
  useBackPress(onClose)
  useEffect(() => {
    if (reduceMotion) {
      Animated.timing(shown, { toValue: 1, duration: 160, useNativeDriver: true }).start()
      return
    }
    Animated.spring(shown, { toValue: 1, ...SPRING, useNativeDriver: true }).start()
  }, [shown, reduceMotion])

  return (
    <KeyboardAvoidingView
      style={[
        StyleSheet.absoluteFill,
        styles.backdrop,
        { paddingTop: screenBounds(0, 0).insetTop },
      ]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {/* Always there, so taps outside the sheet never reach the app behind it. */}
      <Animated.View style={[StyleSheet.absoluteFill, scrim && styles.scrim, { opacity: shown }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={scrim ? onClose : undefined}
          accessible={scrim}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          reduceMotion
            ? { opacity: shown }
            : {
                transform: [
                  {
                    translateY: shown.interpolate({
                      inputRange: [0, 1],
                      outputRange: [height * 0.6, 0],
                    }),
                  },
                ],
              },
        ]}
        accessibilityViewIsModal
      >
        <Surface radius={38} style={styles.sheetSurface}>
          {children}
        </Surface>
      </Animated.View>
    </KeyboardAvoidingView>
  )
}

/** Close or Done on the left, a centered title, and the main action on the right. */
function SheetHeader({
  title,
  subtitle,
  left,
  right,
}: {
  title?: string
  subtitle?: string
  left?: ReactNode
  right?: ReactNode
}) {
  const colors = useColors()
  return (
    <View style={styles.sheetHeader}>
      <View style={styles.sheetSide}>{left}</View>
      <View style={styles.sheetTitle}>
        {title ? (
          <Text style={[text.headline, styles.center, { color: colors.label }]} numberOfLines={1}>
            {title}
          </Text>
        ) : null}
        {subtitle ? (
          <Text
            style={[text.footnote, styles.center, { color: colors.secondary }]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        ) : null}
      </View>
      <View style={[styles.sheetSide, styles.sheetSideRight]}>{right}</View>
    </View>
  )
}

/** A short white flash as the screen is captured, like the system screenshot. */
function CaptureFlash() {
  const opacity = useRef(new Animated.Value(0.85)).current
  const [done, setDone] = useState(false)
  useEffect(() => {
    Animated.timing(opacity, { toValue: 0, duration: 260, useNativeDriver: true }).start(() =>
      setDone(true),
    )
  }, [opacity])
  if (done) return null
  return (
    <Animated.View
      style={[StyleSheet.absoluteFill, styles.flash, { opacity }]}
      pointerEvents="none"
    />
  )
}

/** "A new build is ready" for a moment at the top, then it's just the bubble's dot. */
function NewBuildToast({ build, onPress }: { build: NewerBuild; onPress: () => void }) {
  const colors = useColors()
  return (
    <View style={styles.toastWrap} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLiveRegion="polite"
      >
        <Surface radius={24} style={styles.toast}>
          <View style={[styles.toastDot, { backgroundColor: COLORS.tape }]} />
          <Text style={[text.subhead, styles.strong, { color: colors.label }]}>
            {build.hasFix ? 'Claude’s fix is ready to test' : 'A new build is ready'}
          </Text>
          <Text style={[text.subhead, styles.strong, { color: colors.tint }]}>View</Text>
        </Surface>
      </Pressable>
    </View>
  )
}

type Status =
  | { kind: 'editing' }
  | { kind: 'sending' }
  | {
      kind: 'sent'
      commentUrl: string
      findingId?: string
      triage: Triage
      withScreenshot: boolean
    }
  | { kind: 'error'; message: string }

function Composer({
  screenshot,
  route,
  branch,
  device,
  hasScenario,
  failedStep,
  onSend,
  onSetCause,
  onRequestFix,
  onCancel,
  onClose,
}: {
  screenshot: Screenshot | null
  route: string
  branch: string | undefined
  /** e.g. "iPhone · iOS 26.1", for the list of what's attached. */
  device: string
  /** The report carries the scenario's setup. */
  hasScenario: boolean
  /** Set when the reviewer failed a step; the note becomes optional. */
  failedStep: ChecklistStep | null
  onSend: (input: {
    body: string
    reporterName?: string
    screenshot?: Screenshot
    annotations?: AnnotationBox[]
  }) => ReturnType<typeof sendFeedback>
  onSetCause: (findingId: string, cause: 'pr' | 'unrelated') => ReturnType<typeof sendCause>
  onRequestFix: (findingId: string) => ReturnType<typeof requestFix>
  /** Closed without sending. */
  onCancel: () => void
  /** Closed after sending. */
  onClose: () => void
}) {
  const colors = useColors()
  const { width, height } = useWindowDimensions()
  const [body, setBody] = useState('')
  const [name, setName] = useState(rememberedName)
  const [includeScreenshot, setIncludeScreenshot] = useState(screenshot !== null)
  const [annotations, setAnnotations] = useState<AnnotationBox[]>([])
  const [annotating, setAnnotating] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'editing' })
  const pr = branch?.match(/^pr-(\d+)$/)?.[1]
  const sending = status.kind === 'sending'
  const canSend = (failedStep !== null || body.trim() !== '') && !sending
  const withShot = includeScreenshot && screenshot !== null

  async function send() {
    rememberedName = name.trim()
    setStatus({ kind: 'sending' })
    const result = await onSend({
      body: body.trim(),
      ...(name.trim() ? { reporterName: name.trim() } : {}),
      ...(withShot && screenshot ? { screenshot, annotations } : {}),
    })
    if (!result.ok) {
      haptics.warning()
      setStatus({ kind: 'error', message: result.message })
      return
    }
    haptics.success()
    Keyboard.dismiss()
    setStatus({
      kind: 'sent',
      commentUrl: result.commentUrl,
      withScreenshot: withShot,
      ...(result.findingId ? { findingId: result.findingId } : {}),
      triage: {
        cause: result.cause ?? 'unknown',
        causeSource: result.causeSource ?? 'guess',
        reasons: result.reasons ?? [],
        ...(result.issueUrl ? { issueUrl: result.issueUrl } : {}),
      },
    })
  }

  const attached = [
    withShot ? 'this screenshot' : null,
    `the screen (${route})`,
    hasScenario ? 'the scenario’s setup' : null,
    device,
    'recent logs',
  ].filter(Boolean)
  const attachedText = `Attached: ${attached.slice(0, -1).join(', ')} and ${attached.at(-1)}.`

  return (
    <>
      <Sheet onClose={status.kind === 'sent' ? onClose : onCancel} scrim={status.kind === 'sent'}>
        {status.kind === 'sent' ? (
          <Sent
            pr={pr}
            commentUrl={status.commentUrl}
            triage={status.triage}
            withScreenshot={status.withScreenshot}
            onSetCause={
              status.findingId
                ? (cause) => onSetCause(status.findingId as string, cause)
                : undefined
            }
            onRequestFix={
              status.findingId ? () => onRequestFix(status.findingId as string) : undefined
            }
            onClose={onClose}
          />
        ) : (
          <>
            <SheetHeader
              title={failedStep ? 'Step Failed' : 'Report an Issue'}
              subtitle={pr ? `PR #${pr}` : undefined}
              left={
                <CircleButton icon="xmark" label="Cancel" onPress={onCancel} disabled={sending} />
              }
              right={
                <CircleButton
                  icon="arrow.up"
                  label="Send to PR"
                  tint
                  onPress={send}
                  disabled={!canSend}
                  busy={sending}
                />
              }
            />
            <ScrollView
              keyboardShouldPersistTaps="handled"
              style={styles.sheetScroll}
              contentContainerStyle={styles.form}
            >
              {failedStep ? (
                <View style={styles.quote}>
                  <View style={[styles.quoteMark, { backgroundColor: colors.fail }]}>
                    <Icon name="xmark" size={10} color="#FFFFFF" weight="bold" />
                  </View>
                  <View style={styles.quoteText}>
                    <Text style={[text.subhead, styles.strong, { color: colors.label }]}>
                      {failedStep.action}
                    </Text>
                    <Text style={[text.footnote, { color: colors.secondary }]}>
                      Expected: {failedStep.expect}
                    </Text>
                  </View>
                </View>
              ) : null}
              <TextInput
                value={body}
                onChangeText={setBody}
                placeholder={
                  failedStep
                    ? 'What happened instead? (optional)'
                    : 'What’s wrong? What did you expect?'
                }
                placeholderTextColor={colors.secondary}
                multiline
                autoFocus
                style={[
                  text.body,
                  styles.note,
                  { color: colors.label, backgroundColor: colors.fill },
                ]}
                accessibilityLabel="What's wrong"
              />
              {status.kind === 'error' ? (
                <Text
                  style={[text.footnote, styles.inset, { color: colors.fail }]}
                  accessibilityRole="alert"
                >
                  {status.message}
                </Text>
              ) : null}
              <View style={styles.attach}>
                {screenshot ? (
                  <Pressable
                    onPress={() => setIncludeScreenshot((on) => !on)}
                    accessibilityRole="switch"
                    accessibilityLabel="Include screenshot"
                    accessibilityState={{ checked: includeScreenshot }}
                    style={[
                      styles.thumb,
                      {
                        height: Math.round((THUMB_WIDTH * height) / Math.max(width, 1)),
                        borderColor: colors.separator,
                      },
                      !includeScreenshot && styles.thumbOff,
                    ]}
                  >
                    <Image
                      source={{ uri: `data:${screenshot.contentType};base64,${screenshot.base64}` }}
                      style={StyleSheet.absoluteFill}
                      resizeMode="cover"
                      accessibilityLabel="Screenshot of the current screen"
                    />
                    <View style={styles.thumbX}>
                      <Icon
                        name={includeScreenshot ? 'xmark' : 'arrow.clockwise'}
                        size={8}
                        color="#FFFFFF"
                        weight="bold"
                      />
                    </View>
                  </Pressable>
                ) : null}
                <View style={styles.attachMeta}>
                  {withShot ? (
                    <Pressable
                      onPress={() => setAnnotating(true)}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.pill,
                        { backgroundColor: colors.tintFill },
                        pressed && styles.pressed,
                      ]}
                    >
                      <Text style={[text.subhead, styles.strong, { color: colors.tint }]}>
                        {annotations.length ? `Mark Up (${annotations.length})` : 'Mark Up'}
                      </Text>
                    </Pressable>
                  ) : null}
                  <Text style={[text.footnote, { color: colors.secondary }]}>{attachedText}</Text>
                </View>
              </View>
              <View style={styles.inset}>
                <ReviewerName name={name} onChange={setName} colors={colors} />
              </View>
            </ScrollView>
          </>
        )}
      </Sheet>
      {/* A sibling of the sheet, so it can cover the whole screen. */}
      {annotating && screenshot ? (
        <Annotator
          screenshot={screenshot}
          initial={annotations}
          onDone={(boxes) => {
            setAnnotations(boxes)
            setAnnotating(false)
          }}
          onCancel={() => setAnnotating(false)}
        />
      ) : null}
    </>
  )
}

const THUMB_WIDTH = 55

/** Two choices in one capsule; neither is picked until the cause is known. */
function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: { value: T; title: string }[]
  value: T | null
  onChange: (value: T) => void
  label: string
}) {
  const colors = useColors()
  return (
    <View
      style={[styles.segments, { backgroundColor: colors.fill }]}
      accessibilityRole="radiogroup"
      accessibilityLabel={label}
    >
      {options.map((option) => {
        const on = option.value === value
        return (
          <Pressable
            key={option.value}
            onPress={() => {
              if (on) return
              haptics.selection()
              onChange(option.value)
            }}
            accessibilityRole="radio"
            accessibilityState={{ checked: on }}
            style={[styles.segment, on && [styles.segmentOn, { backgroundColor: colors.segment }]]}
          >
            <Text
              style={[
                text.footnote,
                styles.segmentText,
                on && styles.strong,
                { color: colors.label },
              ]}
              numberOfLines={1}
            >
              {option.title}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * After a report is sent: whether it looks like the PR's bug, and the one tap
 * that follows. A bug the PR didn't cause goes to a prefilled GitHub issue.
 */
function Sent({
  pr,
  commentUrl,
  triage,
  withScreenshot,
  onSetCause,
  onRequestFix,
  onClose,
}: {
  pr: string | undefined
  commentUrl: string
  triage: Triage
  withScreenshot: boolean
  onSetCause: ((cause: 'pr' | 'unrelated') => ReturnType<typeof sendCause>) | undefined
  onRequestFix: (() => ReturnType<typeof requestFix>) | undefined
  onClose: () => void
}) {
  const colors = useColors()
  const [cause, setCause] = useState(triage.cause)
  const [fix, setFix] = useState<'idle' | 'asking' | 'requested' | 'not_set_up'>('idle')
  const [byReporter, setByReporter] = useState(triage.causeSource === 'reporter')
  const [error, setError] = useState<string | null>(null)

  async function askFix() {
    if (!onRequestFix) return
    setFix('asking')
    setError(null)
    const result = await onRequestFix()
    if (result.ok) {
      setFix(result.status)
    } else {
      setFix('idle')
      setError(result.message)
    }
  }

  async function choose(next: 'pr' | 'unrelated') {
    if (!onSetCause) return
    const previous = cause
    setCause(next)
    setByReporter(true)
    setError(null)
    const result = await onSetCause(next)
    if (!result.ok) {
      setCause(previous)
      setError(result.message)
    }
  }

  const why =
    cause === 'unknown'
      ? 'Did this PR cause it, or was it already broken?'
      : !byReporter && triage.reasons.length > 0
        ? triage.reasons.join(' ')
        : cause === 'pr'
          ? 'The author will see it on the PR.'
          : 'It won’t block the merge. File it so it isn’t lost.'

  return (
    <>
      <SheetHeader right={<CircleButton icon="checkmark" label="Done" onPress={onClose} />} />
      <View style={styles.sent}>
        <View style={[styles.bigMark, { backgroundColor: colors.pass }]}>
          <Icon name="checkmark" size={28} color="#FFFFFF" weight="bold" />
        </View>
        <Text style={[text.title2, styles.center, { color: colors.label }]}>
          Sent to {pr ? `PR #${pr}` : 'the PR'}
        </Text>
        <Text style={[text.subhead, styles.center, { color: colors.secondary }]}>
          {withScreenshot ? 'Posted to the PR with your screenshot.' : 'Posted to the PR.'}
        </Text>
      </View>
      {onSetCause ? (
        <Segmented
          label="Cause"
          value={cause === 'unknown' ? null : cause}
          onChange={choose}
          options={[
            { value: 'pr', title: 'Caused by this PR' },
            { value: 'unrelated', title: 'Already broken' },
          ]}
        />
      ) : null}
      <Text style={[text.footnote, styles.center, styles.why, { color: colors.secondary }]}>
        {why}
      </Text>
      <View style={styles.next}>
        {cause === 'pr' && onRequestFix ? (
          fix === 'idle' ? (
            <Capsule title="Ask Claude to Fix" onPress={askFix} />
          ) : (
            <View style={[styles.status, { backgroundColor: colors.fill }]}>
              {fix === 'asking' ? <ActivityIndicator size="small" /> : null}
              <Text style={[text.footnote, styles.statusText, { color: colors.label }]}>
                {fix === 'asking'
                  ? 'Asking Claude…'
                  : fix === 'requested'
                    ? 'Claude is on it. When the fix builds, the Review button shows a dot.'
                    : 'Fix with Claude isn’t set up on this repo yet. The PR comment has the two setup steps for a developer.'}
              </Text>
            </View>
          )
        ) : null}
        {cause === 'unrelated' && triage.issueUrl ? (
          <Capsule
            title="Create GitHub Issue"
            onPress={() => Linking.openURL(triage.issueUrl as string)}
          />
        ) : null}
        {error ? (
          <Text
            style={[text.footnote, styles.center, { color: colors.fail }]}
            accessibilityRole="alert"
          >
            {error}
          </Text>
        ) : null}
        <Capsule kind="plain" title="View on GitHub" onPress={() => Linking.openURL(commentUrl)} />
      </View>
    </>
  )
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  strong: { fontWeight: '600' },
  center: { textAlign: 'center' },
  inset: { paddingHorizontal: 8 },
  backdrop: { justifyContent: 'flex-end' },
  scrim: { backgroundColor: 'rgba(0, 0, 0, 0.14)' },
  flash: { backgroundColor: '#FFFFFF' },
  sheet: { marginHorizontal: 8, marginBottom: 8, flexShrink: 1 },
  sheetSurface: { flexShrink: 1, padding: 8, overflow: 'hidden' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingBottom: 4 },
  sheetSide: { width: 44 },
  sheetSideRight: { alignItems: 'flex-end' },
  sheetTitle: { flex: 1, minWidth: 0 },
  sheetScroll: { flexGrow: 0, flexShrink: 1 },
  form: { paddingHorizontal: 8, paddingTop: 6, paddingBottom: 12, gap: 14 },
  quote: { flexDirection: 'row', gap: 12, alignItems: 'flex-start', paddingHorizontal: 8 },
  quoteMark: {
    width: 22,
    height: 22,
    borderRadius: 11,
    marginTop: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quoteText: { flex: 1, gap: 2 },
  note: {
    minHeight: 104,
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 12,
    textAlignVertical: 'top',
  },
  attach: { flexDirection: 'row', gap: 14, alignItems: 'flex-start', paddingHorizontal: 8 },
  thumb: {
    width: THUMB_WIDTH,
    borderRadius: 9,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
  },
  thumbOff: { opacity: 0.3 },
  thumbX: {
    position: 'absolute',
    top: 4,
    right: 4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(0, 0, 0, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  attachMeta: { flex: 1, gap: 8, alignItems: 'flex-start' },
  pill: { paddingVertical: 7, paddingHorizontal: 16, borderRadius: 999 },
  sent: { alignItems: 'center', gap: 6, paddingHorizontal: 20 },
  bigMark: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  segments: {
    flexDirection: 'row',
    marginTop: 20,
    marginHorizontal: 12,
    padding: 3,
    borderRadius: 999,
  },
  segment: { flex: 1, paddingVertical: 8, borderRadius: 999, alignItems: 'center' },
  segmentOn: {
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  segmentText: { fontSize: 14 },
  why: { paddingHorizontal: 24, paddingTop: 10 },
  next: { paddingHorizontal: 12, paddingTop: 16, paddingBottom: 10, gap: 6 },
  status: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 22,
  },
  statusText: { flex: 1 },
  toastWrap: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 58 : 28,
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 18,
  },
  toastDot: { width: 8, height: 8, borderRadius: 4 },
})
