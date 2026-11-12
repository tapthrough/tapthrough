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
  Switch,
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
import { type Direction, type Nav, ReviewPopover, type SetupStatus } from './Popover.js'
import { controller } from './runtime.js'
import { captureScreenshot, type Screenshot } from './screenshot.js'
import { haptics } from './ui/native.js'

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
      {phase === 'composing' ? (
        <Composer
          screenshot={screenshot}
          route={pathname}
          branch={preview.branch}
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
 * A bottom sheet over a light scrim; tapping the scrim closes it. It's a plain
 * view in the overlay rather than a Modal, because on iOS a Modal can't present
 * while the app is already showing a native modal screen.
 */
function Sheet({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  const { height } = useWindowDimensions()
  const shown = useRef(new Animated.Value(0)).current
  useBackPress(onClose)
  useEffect(() => {
    Animated.timing(shown, { toValue: 1, duration: 260, useNativeDriver: true }).start()
  }, [shown])

  return (
    <KeyboardAvoidingView
      style={[StyleSheet.absoluteFill, styles.backdrop]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, { opacity: shown }]}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close"
        />
      </Animated.View>
      <Animated.View
        style={[
          styles.sheet,
          {
            transform: [
              { translateY: shown.interpolate({ inputRange: [0, 1], outputRange: [height, 0] }) },
            ],
          },
        ]}
        accessibilityViewIsModal
      >
        <View style={styles.grab} />
        {children}
      </Animated.View>
    </KeyboardAvoidingView>
  )
}

/** "A new build is ready" for a moment at the top, then it's just the bubble's dot. */
function NewBuildToast({ build, onPress }: { build: NewerBuild; onPress: () => void }) {
  return (
    <View style={styles.toastWrap} pointerEvents="box-none">
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [styles.toast, pressed && styles.pressed]}
        accessibilityRole="button"
        accessibilityLiveRegion="polite"
      >
        <View style={[styles.toastDot, { backgroundColor: COLORS.tape }]} />
        <Text style={styles.toastText}>
          {build.hasFix ? 'Claude’s fix is ready to test' : 'A new build is ready'}
        </Text>
        <Text style={styles.toastAction}>View</Text>
      </Pressable>
    </View>
  )
}

type Status =
  | { kind: 'editing' }
  | { kind: 'sending' }
  | { kind: 'sent'; commentUrl: string; findingId?: string; triage: Triage }
  | { kind: 'error'; message: string }

function Composer({
  screenshot,
  route,
  branch,
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
  const [body, setBody] = useState('')
  const [name, setName] = useState(rememberedName)
  const [includeScreenshot, setIncludeScreenshot] = useState(screenshot !== null)
  const [annotations, setAnnotations] = useState<AnnotationBox[]>([])
  const [annotating, setAnnotating] = useState(false)
  const [status, setStatus] = useState<Status>({ kind: 'editing' })
  const pr = branch?.match(/^pr-(\d+)$/)?.[1]
  const canSend = (failedStep !== null || body.trim() !== '') && status.kind !== 'sending'

  async function send() {
    rememberedName = name.trim()
    setStatus({ kind: 'sending' })
    const result = await onSend({
      body: body.trim(),
      ...(name.trim() ? { reporterName: name.trim() } : {}),
      ...(includeScreenshot && screenshot ? { screenshot, annotations } : {}),
    })
    setStatus(
      result.ok
        ? {
            kind: 'sent',
            commentUrl: result.commentUrl,
            ...(result.findingId ? { findingId: result.findingId } : {}),
            triage: {
              cause: result.cause ?? 'unknown',
              causeSource: result.causeSource ?? 'guess',
              reasons: result.reasons ?? [],
              ...(result.issueUrl ? { issueUrl: result.issueUrl } : {}),
            },
          }
        : { kind: 'error', message: result.message },
    )
  }

  return (
    <>
      <Sheet onClose={status.kind === 'sent' ? onClose : onCancel}>
        {status.kind === 'sent' ? (
          <Sent
            pr={pr}
            commentUrl={status.commentUrl}
            triage={status.triage}
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
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
            <Text style={styles.title}>
              {failedStep ? 'Step failed' : `Report an issue${pr ? ` on PR #${pr}` : ''}`}
            </Text>
            {failedStep ? (
              <View style={styles.failedStep}>
                <Text style={styles.stepAction}>{failedStep.action}</Text>
                <Text style={styles.muted}>Expected: {failedStep.expect}</Text>
              </View>
            ) : null}
            <Text style={styles.muted} numberOfLines={1}>
              On {route}
            </Text>
            {screenshot ? (
              <View style={styles.shotRow}>
                <Image
                  source={{ uri: `data:${screenshot.contentType};base64,${screenshot.base64}` }}
                  style={[styles.shot, !includeScreenshot && styles.shotOff]}
                  resizeMode="contain"
                  accessibilityLabel="Screenshot of the current screen"
                />
                <View style={styles.shotToggle}>
                  <Text style={styles.label}>Include screenshot</Text>
                  <Switch value={includeScreenshot} onValueChange={setIncludeScreenshot} />
                  {includeScreenshot ? (
                    <Pressable
                      onPress={() => setAnnotating(true)}
                      accessibilityRole="button"
                      hitSlop={8}
                    >
                      <Text style={styles.link}>
                        {annotations.length
                          ? `Mark up (${annotations.length})`
                          : 'Mark up: highlight or blur'}
                      </Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}
            <TextInput
              value={body}
              onChangeText={setBody}
              placeholder={
                failedStep
                  ? 'What happened instead? (optional)'
                  : "What's wrong? What did you expect?"
              }
              placeholderTextColor="#8a8f98"
              multiline
              autoFocus
              style={[styles.input, styles.body]}
              accessibilityLabel="What's wrong"
            />
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name (optional)"
              placeholderTextColor="#8a8f98"
              autoCapitalize="words"
              style={styles.input}
              accessibilityLabel="Your name"
            />
            {status.kind === 'error' ? (
              <Text style={styles.error} accessibilityRole="alert">
                {status.message}
              </Text>
            ) : null}
            <View style={styles.actions}>
              <Pressable onPress={onCancel} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.link}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={send}
                disabled={!canSend}
                style={[styles.primary, !canSend && styles.disabled]}
                accessibilityRole="button"
              >
                {status.kind === 'sending' ? (
                  <ActivityIndicator color="#ffffff" />
                ) : (
                  <Text style={styles.primaryText}>Send to PR</Text>
                )}
              </Pressable>
            </View>
          </ScrollView>
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

/**
 * After a report is sent: whether it looks like the PR's bug, and the one tap
 * that follows. A bug the PR didn't cause goes to a prefilled GitHub issue.
 */
function Sent({
  pr,
  commentUrl,
  triage,
  onSetCause,
  onRequestFix,
  onClose,
}: {
  pr: string | undefined
  commentUrl: string
  triage: Triage
  onSetCause: ((cause: 'pr' | 'unrelated') => ReturnType<typeof sendCause>) | undefined
  onRequestFix: (() => ReturnType<typeof requestFix>) | undefined
  onClose: () => void
}) {
  const [cause, setCause] = useState(triage.cause)
  const [fix, setFix] = useState<'idle' | 'asking' | 'requested' | 'not_set_up'>('idle')

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
  const [byReporter, setByReporter] = useState(triage.causeSource === 'reporter')
  const [error, setError] = useState<string | null>(null)
  const where = pr ? `PR #${pr}` : 'the PR'

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

  const heading =
    cause === 'pr'
      ? `Sent to ${where}`
      : cause === 'unrelated'
        ? 'Looks like this was already broken'
        : `Sent to ${where}`
  const summary =
    cause === 'pr'
      ? byReporter
        ? 'Marked as caused by this PR. The author will see it in the PR.'
        : 'This looks like it comes from this PR, so it’s on the PR for the author to fix.'
      : cause === 'unrelated'
        ? byReporter
          ? 'Marked as not from this PR. It won’t block the merge; file it so it isn’t lost.'
          : 'Nothing this PR changes reaches this screen, so it won’t block the merge. File it so it isn’t lost.'
        : 'Did this PR cause it, or was it already broken?'

  return (
    <View style={styles.sent}>
      <Text style={styles.title}>{heading}</Text>
      <Text style={styles.muted}>{summary}</Text>
      {!byReporter && triage.reasons.length > 0 ? (
        <Text style={styles.reason}>{triage.reasons.join(' ')}</Text>
      ) : null}
      {cause === 'unknown' && onSetCause ? (
        <View style={styles.causeRow}>
          <Pressable
            onPress={() => choose('pr')}
            style={styles.secondary}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>This PR caused it</Text>
          </Pressable>
          <Pressable
            onPress={() => choose('unrelated')}
            style={styles.secondary}
            accessibilityRole="button"
          >
            <Text style={styles.secondaryText}>Already broken</Text>
          </Pressable>
        </View>
      ) : null}
      {cause === 'unrelated' && triage.issueUrl ? (
        <Pressable
          onPress={() => Linking.openURL(triage.issueUrl as string)}
          style={[styles.primary, styles.wide]}
          accessibilityRole="link"
        >
          <Text style={styles.primaryText}>Create issue on GitHub</Text>
        </Pressable>
      ) : null}
      {cause === 'pr' && onRequestFix ? (
        fix === 'requested' ? (
          <Text style={styles.reason}>
            Claude is looking into it. If it finds the cause, it pushes a fix to the PR. When the
            new build is ready, the Review button shows a dot.
          </Text>
        ) : fix === 'not_set_up' ? (
          <Text style={styles.reason}>
            Fix with Claude isn’t set up on this repo yet. The PR comment has the two setup steps
            for a developer.
          </Text>
        ) : (
          <Pressable
            onPress={askFix}
            disabled={fix === 'asking'}
            style={[styles.secondary, styles.wide, fix === 'asking' && styles.disabled]}
            accessibilityRole="button"
          >
            {fix === 'asking' ? (
              <ActivityIndicator color="#1a73e8" />
            ) : (
              <Text style={styles.secondaryText}>Ask Claude to fix</Text>
            )}
          </Pressable>
        )
      ) : null}
      {cause !== 'unknown' && onSetCause ? (
        <Pressable
          onPress={() => choose(cause === 'pr' ? 'unrelated' : 'pr')}
          accessibilityRole="button"
          hitSlop={8}
        >
          <Text style={styles.link}>
            {cause === 'pr'
              ? 'Not from this PR? It was already broken'
              : 'Actually, this PR caused it'}
          </Text>
        </Pressable>
      ) : null}
      {error ? (
        <Text style={styles.error} accessibilityRole="alert">
          {error}
        </Text>
      ) : null}
      <View style={styles.actions}>
        <Pressable onPress={() => Linking.openURL(commentUrl)} accessibilityRole="link">
          <Text style={styles.link}>View on GitHub</Text>
        </Pressable>
        <Pressable onPress={onClose} style={styles.primary} accessibilityRole="button">
          <Text style={styles.primaryText}>Done</Text>
        </Pressable>
      </View>
    </View>
  )
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.7 },
  backdrop: { justifyContent: 'flex-end' },
  scrim: { backgroundColor: 'rgba(0, 0, 0, 0.18)' },
  sheet: {
    maxHeight: '85%',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    backgroundColor: '#ffffff',
    shadowColor: '#000000',
    shadowOpacity: 0.12,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -2 },
    elevation: 12,
  },
  grab: {
    alignSelf: 'center',
    width: 36,
    height: 5,
    marginTop: 8,
    borderRadius: 3,
    backgroundColor: '#d8dbe0',
  },
  sheetHead: { paddingHorizontal: 20, paddingTop: 10, gap: 10 },
  bar: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    backgroundColor: '#eceef1',
  },
  barFill: { height: 4 },
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
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(14, 22, 32, 0.94)',
    shadowColor: '#000000',
    shadowOpacity: 0.2,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  toastDot: { width: 8, height: 8, borderRadius: 4 },
  toastText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  toastAction: { color: COLORS.tape, fontSize: 14, fontWeight: '700' },
  newer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderRadius: 12,
    backgroundColor: '#fbf6df',
    borderWidth: 1,
    borderColor: COLORS.tape,
  },
  newerText: { flex: 1, gap: 2 },
  newerTitle: { fontSize: 15, fontWeight: '700', color: COLORS.tapeInk },
  newerMeta: { fontSize: 12, color: '#6b6040' },
  newerButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: COLORS.ink,
  },
  newerButtonText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  nameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  nameStrong: { fontWeight: '600', color: '#16181d' },
  linkSmall: { fontSize: 14, fontWeight: '600', color: '#1a73e8' },
  inputSlim: { paddingVertical: 8, fontSize: 15 },
  form: { padding: 20, paddingTop: 14, paddingBottom: 32, gap: 12 },
  sent: { padding: 20, paddingBottom: 40, gap: 8 },
  reason: { fontSize: 13, color: '#5b6170', lineHeight: 18 },
  causeRow: { flexDirection: 'row', gap: 8, marginTop: 4 },
  wide: { flex: 0, alignSelf: 'stretch', alignItems: 'center', marginTop: 4 },
  title: { fontSize: 18, fontWeight: '700', color: '#16181d' },
  muted: { fontSize: 13, color: '#5f6672' },
  label: { fontSize: 14, color: '#16181d' },
  shotRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  shot: { width: 72, height: 150, borderRadius: 8, backgroundColor: '#f1f2f4' },
  shotOff: { opacity: 0.3 },
  shotToggle: { flex: 1, gap: 6, alignItems: 'flex-start' },
  input: {
    fontSize: 16,
    color: '#16181d',
    borderWidth: 1,
    borderColor: '#d8dbe0',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  body: { minHeight: 100, textAlignVertical: 'top' },
  error: { fontSize: 14, color: '#c5221f' },
  actions: {
    marginTop: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  link: { fontSize: 16, fontWeight: '600', color: '#1a73e8' },
  primary: {
    minWidth: 120,
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 18,
    borderRadius: 10,
    backgroundColor: '#1a73e8',
  },
  primaryText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  secondary: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#1a73e8',
  },
  secondaryText: { color: '#1a73e8', fontSize: 15, fontWeight: '600' },
  disabled: { opacity: 0.4 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  scenario: { gap: 10, marginTop: 4 },
  scenarioTitle: { fontSize: 15, fontWeight: '700', color: '#16181d' },
  step: {
    gap: 4,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#f4f5f7',
  },
  stepAction: { fontSize: 15, fontWeight: '600', color: '#16181d' },
  stepButtons: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 6 },
  small: { paddingVertical: 7, paddingHorizontal: 14, borderRadius: 8, borderWidth: 1 },
  smallPass: { borderColor: COLORS.pass },
  smallPassOn: { backgroundColor: COLORS.pass },
  smallPassText: { color: COLORS.pass, fontSize: 14, fontWeight: '600' },
  smallFail: { borderColor: COLORS.fail },
  smallFailOn: { backgroundColor: COLORS.fail },
  smallFailText: { color: COLORS.fail, fontSize: 14, fontWeight: '600' },
  smallOnText: { color: '#ffffff' },
  other: { alignSelf: 'center', paddingVertical: 12 },
  failedStep: { gap: 2, padding: 10, borderRadius: 8, backgroundColor: '#fdecea' },
})
