import Constants from 'expo-constants'
import { usePathname } from 'expo-router'
import { useEffect, useMemo, useState } from 'react'
import {
  ActivityIndicator,
  Image,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native'
import { Annotator } from './Annotator.js'
import type { AnnotationBox } from './core/annotations.js'
import { createDiagnostics, installDiagnostics } from './core/diagnostics.js'
import {
  type Checklist,
  type ChecklistStep,
  failedStepBody,
  fetchChecklist,
  hasReviewItems,
  previewContextFromManifest,
  type RecheckItem,
  requestFix,
  type StepResultValue,
  sendCause,
  sendFeedback,
  sendRecheck,
  sendStepResult,
  type Triage,
} from './core/feedback.js'
import { controller } from './runtime.js'
import { captureScreenshot, type Screenshot } from './screenshot.js'

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

interface FailingStep {
  scenarioKey: string
  step: ChecklistStep
}

/**
 * A small Review button over a PR preview. It opens the PR's checklist (pass or
 * fail each step) or, without a plan, goes straight to reporting an issue with
 * a screenshot of the screen behind it.
 */
export function ReportButton({ apiUrl }: { apiUrl: string }) {
  const preview = useMemo(() => previewContextFromManifest(Constants.manifest2), [])
  const pathname = usePathname()
  const [phase, setPhase] = useState<'idle' | 'loading' | 'checklist' | 'capturing' | 'composing'>(
    'idle',
  )
  const [checklist, setChecklist] = useState<Checklist | null>(null)
  const [failing, setFailing] = useState<FailingStep | null>(null)
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null)

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

  if (!preview || (Platform.OS !== 'ios' && Platform.OS !== 'android')) return null
  const platform = Platform.OS as 'ios' | 'android'

  async function open() {
    setPhase('loading')
    const list = await fetchChecklist(preview as NonNullable<typeof preview>, platform, { apiUrl })
    if (hasReviewItems(list)) {
      setChecklist(list)
      setPhase('checklist')
    } else {
      await startReport(null)
    }
  }

  /** Hides everything, screenshots the app, then opens the composer. */
  async function startReport(step: FailingStep | null) {
    setFailing(step)
    setPhase('capturing')
    await nextFrame()
    setScreenshot(await captureScreenshot())
    setPhase('composing')
  }

  function close() {
    setPhase('idle')
    setScreenshot(null)
    setFailing(null)
  }

  return (
    <>
      {phase === 'idle' || phase === 'loading' ? (
        <Pressable
          onPress={open}
          disabled={phase === 'loading'}
          style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
          accessibilityRole="button"
          accessibilityLabel="Review this pull request: check off steps or report an issue"
          hitSlop={8}
        >
          {phase === 'loading' ? (
            <ActivityIndicator color="#ffffff" />
          ) : (
            <Text style={styles.pillText}>Review</Text>
          )}
        </Pressable>
      ) : null}
      {phase === 'checklist' && checklist ? (
        <ReviewSheet
          checklist={checklist}
          onResult={(scenarioKey, step, result) =>
            sendStepResult(
              {
                preview,
                platform,
                scenarioKey,
                stepIndex: step.index,
                result,
                ...(rememberedName ? { reporterName: rememberedName } : {}),
              },
              { apiUrl },
            )
          }
          onFail={(scenarioKey, step) => startReport({ scenarioKey, step })}
          onRecheck={(findingId, result) =>
            sendRecheck(
              {
                preview,
                platform,
                findingId,
                result,
                ...(rememberedName ? { reporterName: rememberedName } : {}),
              },
              { apiUrl },
            )
          }
          onReportOther={() => startReport(null)}
          onClose={close}
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
          onClose={close}
        />
      ) : null}
    </>
  )
}

const RESULT_LABEL: Record<StepResultValue, string> = {
  pass: 'Passed',
  fail: 'Failed',
  skip: 'Skipped',
}

/** The PR's test plan: pass or fail each step; failing one files a report about it. */
function ReviewSheet({
  checklist,
  onResult,
  onFail,
  onRecheck,
  onReportOther,
  onClose,
}: {
  checklist: Checklist
  onResult: (
    scenarioKey: string,
    step: ChecklistStep,
    result: StepResultValue,
  ) => ReturnType<typeof sendStepResult>
  onFail: (scenarioKey: string, step: ChecklistStep) => void
  onRecheck: (findingId: string, result: 'fixed' | 'still_broken') => ReturnType<typeof sendRecheck>
  onReportOther: () => void
  onClose: () => void
}) {
  const [name, setName] = useState(rememberedName)
  const [results, setResults] = useState<Record<string, StepResultValue | undefined>>(() =>
    Object.fromEntries(
      checklist.scenarios.flatMap((scenario) =>
        scenario.steps.map((step) => [`${scenario.key}:${step.index}`, step.result?.result]),
      ),
    ),
  )
  const [error, setError] = useState<string | null>(null)
  const [rechecked, setRechecked] = useState<Record<string, 'fixed' | 'still_broken'>>({})

  async function recheck(item: RecheckItem, result: 'fixed' | 'still_broken') {
    rememberedName = name.trim()
    setRechecked((current) => ({ ...current, [item.id]: result }))
    const response = await onRecheck(item.id, result)
    if (!response.ok) {
      setRechecked(({ [item.id]: _, ...rest }) => rest)
      setError(response.message)
    }
  }

  async function pass(scenarioKey: string, step: ChecklistStep) {
    rememberedName = name.trim()
    const id = `${scenarioKey}:${step.index}`
    const previous = results[id]
    setResults((current) => ({ ...current, [id]: 'pass' }))
    const result = await onResult(scenarioKey, step, 'pass')
    if (!result.ok) {
      setResults((current) => ({ ...current, [id]: previous }))
      setError(result.message)
    }
  }

  function fail(scenarioKey: string, step: ChecklistStep) {
    rememberedName = name.trim()
    onFail(scenarioKey, step)
  }

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.form}>
            <View style={styles.headerRow}>
              <Text style={styles.title}>Review PR #{checklist.pr}</Text>
              <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
                <Text style={styles.link}>Close</Text>
              </Pressable>
            </View>
            <TextInput
              value={name}
              onChangeText={setName}
              placeholder="Your name (shown on the PR)"
              placeholderTextColor="#8a8f98"
              autoCapitalize="words"
              style={styles.input}
              accessibilityLabel="Your name"
            />
            {checklist.recheck?.length ? (
              <View style={styles.scenario}>
                <Text style={styles.scenarioTitle}>Re-check earlier reports</Text>
                {checklist.recheck.map((item) => {
                  const done = rechecked[item.id]
                  return (
                    <View key={item.id} style={styles.step}>
                      <Text style={styles.stepAction}>{item.excerpt}</Text>
                      <Text style={styles.muted}>
                        {[item.reporter, `reported on ${item.sha.slice(0, 7)}`]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                      <View style={styles.stepActions}>
                        {done || item.stillBrokenHere ? (
                          <Text style={[styles.stepStatus, done !== 'fixed' && styles.error]}>
                            {done === 'fixed' ? 'Fixed' : 'Still broken'}
                          </Text>
                        ) : (
                          <View />
                        )}
                        <View style={styles.stepButtons}>
                          <Pressable
                            onPress={() => recheck(item, 'still_broken')}
                            style={[styles.small, styles.smallFail]}
                            accessibilityRole="button"
                            accessibilityLabel={`Still broken: ${item.excerpt}`}
                          >
                            <Text style={styles.smallFailText}>Still broken</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => recheck(item, 'fixed')}
                            style={[styles.small, styles.smallPass]}
                            accessibilityRole="button"
                            accessibilityLabel={`Fixed: ${item.excerpt}`}
                          >
                            <Text style={styles.smallPassText}>Fixed</Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  )
                })}
              </View>
            ) : null}
            {checklist.scenarios.map((scenario) => (
              <View key={scenario.key} style={styles.scenario}>
                <Text style={styles.scenarioTitle}>{scenario.title}</Text>
                {scenario.steps.map((step) => {
                  const current = results[`${scenario.key}:${step.index}`]
                  return (
                    <View key={step.index} style={styles.step}>
                      <Text style={styles.stepAction}>{step.action}</Text>
                      <Text style={styles.muted}>Expect: {step.expect}</Text>
                      <View style={styles.stepActions}>
                        {current ? (
                          <Text style={[styles.stepStatus, current === 'fail' && styles.error]}>
                            {RESULT_LABEL[current]}
                          </Text>
                        ) : (
                          <View />
                        )}
                        <View style={styles.stepButtons}>
                          <Pressable
                            onPress={() => fail(scenario.key, step)}
                            style={[styles.small, styles.smallFail]}
                            accessibilityRole="button"
                            accessibilityLabel={`Fail: ${step.action}`}
                          >
                            <Text style={styles.smallFailText}>Fail</Text>
                          </Pressable>
                          <Pressable
                            onPress={() => pass(scenario.key, step)}
                            style={[styles.small, styles.smallPass]}
                            accessibilityRole="button"
                            accessibilityLabel={`Pass: ${step.action}`}
                          >
                            <Text style={styles.smallPassText}>Pass</Text>
                          </Pressable>
                        </View>
                      </View>
                    </View>
                  )
                })}
              </View>
            ))}
            {error ? (
              <Text style={styles.error} accessibilityRole="alert">
                {error}
              </Text>
            ) : null}
            <Pressable onPress={onReportOther} accessibilityRole="button" style={styles.other}>
              <Text style={styles.link}>Report something else</Text>
            </Pressable>
          </ScrollView>
        </View>
      </View>
    </Modal>
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
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={styles.backdrop}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.sheet}>
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
                <Pressable onPress={onClose} accessibilityRole="button" hitSlop={8}>
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
        </View>
      </KeyboardAvoidingView>
    </Modal>
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
            Claude is looking into it. If it finds the cause, it pushes a fix to the PR, and a new
            build follows for you to re-check.
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
  pill: {
    position: 'absolute',
    right: 16,
    bottom: 44,
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 999,
    backgroundColor: 'rgba(24, 24, 27, 0.88)',
  },
  pressed: { opacity: 0.7 },
  pillText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0, 0, 0, 0.4)' },
  sheet: {
    maxHeight: '90%',
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    backgroundColor: '#ffffff',
  },
  form: { padding: 20, gap: 12 },
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
  stepActions: {
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  stepButtons: { flexDirection: 'row', gap: 8 },
  stepStatus: { fontSize: 13, fontWeight: '600', color: '#1e7e34' },
  small: { paddingVertical: 8, paddingHorizontal: 16, borderRadius: 8 },
  smallPass: { backgroundColor: '#1e7e34' },
  smallPassText: { color: '#ffffff', fontSize: 14, fontWeight: '600' },
  smallFail: { backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#c5221f' },
  smallFailText: { color: '#c5221f', fontSize: 14, fontWeight: '600' },
  other: { alignSelf: 'center', paddingVertical: 12 },
  failedStep: { gap: 2, padding: 10, borderRadius: 8, backgroundColor: '#fdecea' },
})
