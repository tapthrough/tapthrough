import {
  afterScenario,
  type Checklist,
  type ChecklistScenario,
  type ChecklistStep,
  nextOpenScenario,
  nextOpenStep,
  prsToReview,
  type RecheckItem,
  type Results,
  resetMessage,
  reviewBadge,
  type ScenarioProgress,
  scenarioProgress,
  screenPosition,
  stepId,
} from '@tapthrough/core'
import {
  type ClipboardEvent,
  type ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { canCaptureTab, captureTab, fileToScreenshot, type Screenshot } from './image.js'
import { routeMatches } from './route.js'
import { type ReviewState, type ReviewStore, setUpLabel } from './store.js'

const NAME_KEY = 'tapthrough:name'

/** The reviewer's name, kept in this browser so reports say who sent them. */
function useReviewerName(): [string, (name: string) => void] {
  const [name, setName] = useState('')
  useEffect(() => {
    try {
      setName(window.localStorage.getItem(NAME_KEY) ?? '')
    } catch {
      // Storage is blocked; the name just isn't remembered.
    }
  }, [])
  return [
    name,
    (next) => {
      setName(next)
      try {
        window.localStorage.setItem(NAME_KEY, next)
      } catch {
        // See above.
      }
    },
  ]
}

function useReview(store: ReviewStore) {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState)
}

/** What the panel needs from the page to take a screenshot of it without itself in the picture. */
export interface Capture {
  /** Hides the panel, captures the tab, and shows the panel again. Null when cancelled. */
  tab(): Promise<Screenshot | null>
  available: boolean
}

/**
 * A screenshot to go with a report: capture this tab, pick a file, or paste
 * one into the note. Shows a thumbnail of what will be sent.
 */
function Attachment({
  store,
  capture,
  value,
  onChange,
}: {
  store: ReviewStore
  capture: Capture
  value: Screenshot | null
  onChange: (next: Screenshot | null) => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [working, setWorking] = useState(false)

  async function attach(make: () => Promise<Screenshot | null>) {
    setWorking(true)
    try {
      const next = await make()
      if (next) onChange(next)
    } catch (error) {
      store.setError(error instanceof Error ? error.message : "Couldn't attach that image.")
    } finally {
      setWorking(false)
    }
  }

  if (value) {
    return (
      <div className="shot">
        <img src={`data:${value.contentType};base64,${value.base64}`} alt="Screenshot to send" />
        <button type="button" className="link" onClick={() => onChange(null)}>
          Remove screenshot
        </button>
      </div>
    )
  }
  return (
    <div className="attach">
      {capture.available ? (
        <button
          type="button"
          className="link"
          disabled={working}
          onClick={() => attach(capture.tab)}
        >
          Capture this tab
        </button>
      ) : null}
      <button
        type="button"
        className="link"
        disabled={working}
        onClick={() => fileRef.current?.click()}
      >
        Attach an image
      </button>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        aria-label="Attach an image"
        onChange={(event) => {
          const file = event.target.files?.[0]
          event.target.value = ''
          if (file) void attach(() => fileToScreenshot(file))
        }}
      />
    </div>
  )
}

/** Pasting an image into a note attaches it. */
function pastedImage(event: ClipboardEvent): Blob | null {
  for (const item of Array.from(event.clipboardData?.items ?? [])) {
    if (item.kind === 'file' && item.type.startsWith('image/')) return item.getAsFile()
  }
  return null
}

function useScreenshot(store: ReviewStore) {
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null)
  return {
    screenshot,
    setScreenshot,
    onPaste(event: ClipboardEvent) {
      const image = pastedImage(event)
      if (!image) return
      event.preventDefault()
      fileToScreenshot(image).then(setScreenshot, (error: unknown) => {
        store.setError(error instanceof Error ? error.message : "Couldn't attach that image.")
      })
    },
  }
}

/* ------------------------------- navigation ------------------------------- */

/** Where the reviewer is inside the panel. Kept across page loads, so "Open page" lands on its step. */
export type Nav =
  | { view: 'list' }
  | { view: 'brief'; key: string }
  /** `index` is the step's position in the scenario's `steps`. */
  | { view: 'step'; key: string; index: number }
  /** The note that goes with failing that step. */
  | { view: 'fail'; key: string; index: number }
  | { view: 'done'; key: string }
  | { view: 'recheck'; id: string }
  /** An issue that isn't about a step. */
  | { view: 'report' }

const PANEL_KEY = 'tapthrough:panel'

interface Saved {
  pr: number
  open: boolean
  nav: Nav
}

function readSaved(): Saved | null {
  try {
    const saved = JSON.parse(window.sessionStorage.getItem(PANEL_KEY) ?? 'null') as Saved | null
    return saved && typeof saved.pr === 'number' && typeof saved.nav?.view === 'string'
      ? saved
      : null
  } catch {
    return null
  }
}

function writeSaved(saved: Saved) {
  try {
    window.sessionStorage.setItem(PANEL_KEY, JSON.stringify(saved))
  } catch {
    // Storage is blocked; the panel just starts from the list after a page load.
  }
}

/** The page's path, kept current while the app navigates without a page load. */
function usePath(read: () => string | undefined, watch: boolean) {
  const [path, setPath] = useState(read)
  const readRef = useRef(read)
  readRef.current = read
  useEffect(() => {
    if (!watch) return
    const check = () => setPath(readRef.current())
    check()
    window.addEventListener('popstate', check)
    // Client-side navigation has no event of its own.
    const timer = window.setInterval(check, 500)
    return () => {
      window.removeEventListener('popstate', check)
      window.clearInterval(timer)
    }
  }, [watch])
  return path
}

function firstFailed(scenario: ChecklistScenario, results: Results): number {
  return scenario.steps.findIndex((step) => results[stepId(scenario.key, step.index)] === 'fail')
}

/** A scenario not started opens its brief; one in progress opens its next step. */
function openScenario(scenario: ChecklistScenario, results: Results): Nav {
  if (scenarioProgress(scenario, results).checked === 0) return { view: 'brief', key: scenario.key }
  const open = nextOpenStep(scenario, results)
  return open >= 0
    ? { view: 'step', key: scenario.key, index: open }
    : { view: 'done', key: scenario.key }
}

/** Past the brief: the first step left, or the summary when there's none. */
function startScenario(scenario: ChecklistScenario, results: Results): Nav {
  if (scenario.steps.length === 0) return { view: 'list' }
  const open = nextOpenStep(scenario, results)
  return open >= 0
    ? { view: 'step', key: scenario.key, index: open }
    : { view: 'done', key: scenario.key }
}

function plural(n: number, unit: string) {
  return `${n} ${unit}${n === 1 ? '' : 's'}`
}

function reportedBy(item: RecheckItem) {
  return `${item.reporter ?? 'A reviewer'} reported this on ${item.sha.slice(0, 7)}`
}

/* --------------------------------- pieces --------------------------------- */

function Mark({
  kind,
  large,
}: {
  kind: 'pass' | 'fail' | 'open' | 'partial' | 'redo'
  large?: boolean
}) {
  const glyph = { pass: '✓', fail: '✕', open: '', partial: '', redo: '↻' }[kind]
  return (
    <span className={`mark ${kind}${large ? ' large' : ''}`} aria-hidden="true">
      {glyph}
    </span>
  )
}

function progressMark(progress: ScenarioProgress) {
  return (
    <Mark
      kind={
        progress.state === 'passed'
          ? 'pass'
          : progress.state === 'failed'
            ? 'fail'
            : progress.state === 'partial'
              ? 'partial'
              : 'open'
      }
    />
  )
}

function Row({
  lead,
  title,
  subtitle,
  onClick,
  href,
}: {
  lead: ReactNode
  title: string
  subtitle?: string | undefined
  onClick?: () => void
  href?: string | undefined
}) {
  const inner = (
    <>
      {lead}
      <span className="grow">
        <span className="rowtitle">{title}</span>
        {subtitle ? <span className="rowsub">{subtitle}</span> : null}
      </span>
      {onClick || href ? (
        <span className="chev" aria-hidden="true">
          ›
        </span>
      ) : null}
    </>
  )
  if (href) {
    return (
      <li>
        <a className="rowbtn" href={href}>
          {inner}
        </a>
      </li>
    )
  }
  return (
    <li>
      {onClick ? (
        <button type="button" className="rowbtn" onClick={onClick}>
          {inner}
        </button>
      ) : (
        <span className="rowbtn static">{inner}</span>
      )}
    </li>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="section">
      <h3>{title}</h3>
      {children}
    </section>
  )
}

function Numbered({ items }: { items: { title: string; detail?: string }[] }) {
  return (
    <ol className="numbered">
      {items.map((item, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: a fixed list, shown in order
        <li key={i}>
          <span className="num" aria-hidden="true">
            {i + 1}
          </span>
          <span className="grow">
            <span className="rowtitle">{item.title}</span>
            {item.detail ? <span className="rowsub">Expect: {item.detail}</span> : null}
          </span>
        </li>
      ))}
    </ol>
  )
}

/** A screen of the panel: what the header says, what scrolls, and what stays at the bottom. */
interface Screen {
  title: string
  subtitle?: string
  /** Shows ‹ and where it goes. */
  back?: Nav
  body: ReactNode
  footer?: ReactNode
}

interface Ctx {
  store: ReviewStore
  state: ReviewState
  checklist: Checklist
  name: string
  setName: (name: string) => void
  nameId: string
  capture: Capture
  path: string | undefined
  go: (nav: Nav) => void
  close: () => void
  /** Leaves this page for `url`, coming back to the panel at `then`. */
  leave: (url: string, then: Nav) => void
}

/* ---------------------------------- views --------------------------------- */

/** What's left on this PR and its one next action. */
function prProgress({ checklist, state, path }: Ctx) {
  const { results } = state
  const scenarios = checklist.scenarios.filter((s) => s.steps.length > 0)
  const recheck = (checklist.recheck ?? []).filter(
    (item) => !(state.rechecked[item.id] ?? (item.stillBrokenHere ? 'still_broken' : undefined)),
  )
  const progress = scenarios.map((s) => scenarioProgress(s, results))
  const done = progress.filter((p) => p.state !== 'new' && p.state !== 'partial').length
  const failed = progress.reduce((n, p) => n + p.failed, 0)
  // The page the reviewer is already on comes first.
  const here = scenarios.find(
    (s) => routeMatches(s.routePath, path) && nextOpenStep(s, results) >= 0,
  )
  const next = here ?? nextOpenScenario(checklist, results)
  return { scenarios, recheck, done, failed, next, total: scenarios.length }
}

function scenarioSubtitle(c: Ctx, scenario: ChecklistScenario, progress: ScenarioProgress) {
  const here = routeMatches(scenario.routePath, c.path) ? 'This page · ' : ''
  if (c.checklist.walkthrough) {
    if (progress.state === 'failed') return `${here}Failed`
    if (progress.state === 'passed') return `${here}Passed`
    return `${here}Not checked yet`
  }
  if (progress.state === 'new') {
    const auto = setUpLabel(c.checklist, scenario.routePath) === 'Set up'
    return `${here}${plural(progress.total, 'step')}${auto ? ' · sets itself up' : ''}`
  }
  if (progress.state === 'partial') return `${here}${progress.checked} of ${progress.total} checked`
  if (progress.state === 'failed') return `${here}${progress.failed} failed`
  return `${here}All passed`
}

/**
 * The PR's review: what to check, one obvious next action, and once it's all
 * checked, Approve and other PRs to review. Only things the reviewer can act on are listed.
 */
function listView(c: Ctx): Screen {
  const { checklist, state, store } = c
  const { results } = state
  const { scenarios, recheck, done, failed, next, total } = prProgress(c)
  const finished = !next && recheck.length === 0
  const nothingPlanned = total === 0 && (checklist.recheck ?? []).length === 0
  const others = prsToReview(state.pulls)
  const approved = state.approved
  const canApprove = !approved && checklist.open && (nothingPlanned || (finished && failed === 0))
  const auto = checklist.web?.launch !== 'off'

  let lead: string
  if (approved) {
    lead = state.approveNote ?? `PR #${checklist.pr} is approved.`
  } else if (nothingPlanned) {
    lead = checklist.open
      ? 'Nothing to check on this PR. Look around the app, report anything off, then approve it.'
      : 'Nothing to check on this PR. You can still look around and report anything off.'
  } else if (finished) {
    const unit = checklist.walkthrough ? 'screen' : 'step'
    lead = failed
      ? `${plural(failed, unit)} failed, and your reports are on PR #${checklist.pr}. Fixed now? Check again and press Pass.`
      : `Everything passed. Approve PR #${checklist.pr} to tell the team it’s good to merge.`
  } else if (done === 0 && recheck.length === 0 && checklist.walkthrough) {
    // Only shared code changed: say what changed, then go screen by screen.
    lead = checklist.walkthrough.intro
  } else if (done === 0 && recheck.length === 0) {
    lead = `Check ${total === 1 ? 'this' : `these ${total}`} on PR #${checklist.pr}. Each one ${auto ? 'sets the app up' : 'opens its page'} and walks you through it.`
  } else {
    lead = `${total - done + recheck.length} left to check on PR #${checklist.pr}.`
  }

  let cta: ReactNode
  if (canApprove) {
    const busy = state.busy.has('approve')
    cta = (
      <button
        type="button"
        className="cta"
        disabled={busy}
        onClick={() => store.approve(c.name || undefined)}
      >
        {busy ? 'Approving…' : `Approve PR #${checklist.pr}`}
      </button>
    )
  } else if (approved) {
    cta = (
      <button type="button" className={`cta ${others.length ? 'plain' : ''}`} onClick={c.close}>
        Done
      </button>
    )
  } else if (recheck[0]) {
    const item = recheck[0]
    cta = (
      <button type="button" className="cta" onClick={() => c.go({ view: 'recheck', id: item.id })}>
        Re-check Earlier Report
      </button>
    )
  } else if (next) {
    const started = scenarioProgress(next, results).checked > 0
    cta = (
      <button type="button" className="cta" onClick={() => c.go(openScenario(next, results))}>
        {started ? 'Continue' : done === 0 ? 'Start' : 'Next'}: {next.title}
      </button>
    )
  } else {
    const scenario = failed > 0 ? scenarios.find((s) => firstFailed(s, results) >= 0) : undefined
    cta = scenario ? (
      <button
        type="button"
        className="cta"
        onClick={() =>
          c.go({ view: 'step', key: scenario.key, index: firstFailed(scenario, results) })
        }
      >
        Check Failed Step Again
      </button>
    ) : (
      <button type="button" className="cta" onClick={c.close}>
        Done
      </button>
    )
  }

  const newer = checklist.newerBuild
  return {
    title: `PR #${checklist.pr}`,
    subtitle: `${
      approved
        ? 'Approved'
        : nothingPlanned
          ? 'Nothing to check'
          : finished
            ? failed
              ? `${failed} failed`
              : 'All passed'
            : `${done} of ${total} checked`
    } · ${checklist.sha.slice(0, 7)}`,
    body: (
      <>
        {!checklist.open ? (
          <p className="note">This pull request is closed, so results can&apos;t be saved.</p>
        ) : null}
        {newer ? (
          <p className="note">
            There&apos;s a newer push to this PR ({newer.sha.slice(0, 7)}
            {newer.hasFix ? ', with a fix' : ''}).{' '}
            <a href={newer.openUrl ?? `https://${newer.updateGroupId}`}>Open its preview</a>
          </p>
        ) : null}
        {checklist.reset ? <p className="note">{resetMessage(checklist.reset)}</p> : null}
        {state.lastReportUrl ? (
          <p className="note" role="status">
            Report posted.{' '}
            <a href={state.lastReportUrl} target="_blank" rel="noreferrer">
              See it on the PR
            </a>
          </p>
        ) : null}
        <p className="lead">{lead}</p>
        {approved ? null : (
          <ul className="rows">
            {(checklist.recheck ?? []).map((item) => {
              const verdict =
                state.rechecked[item.id] ?? (item.stillBrokenHere ? 'still_broken' : undefined)
              return (
                <Row
                  key={item.id}
                  lead={<Mark kind={verdict === 'fixed' ? 'pass' : verdict ? 'fail' : 'redo'} />}
                  title={`Re-check: ${item.excerpt}`}
                  subtitle={
                    verdict === 'fixed'
                      ? 'Fixed here'
                      : verdict
                        ? 'Still broken here'
                        : reportedBy(item)
                  }
                  onClick={() => c.go({ view: 'recheck', id: item.id })}
                />
              )
            })}
            {scenarios.map((scenario) => {
              const progress = scenarioProgress(scenario, results)
              return (
                <Row
                  key={scenario.key}
                  lead={progressMark(progress)}
                  title={scenario.title}
                  subtitle={scenarioSubtitle(c, scenario, progress)}
                  onClick={() => c.go(openScenario(scenario, results))}
                />
              )
            })}
          </ul>
        )}
        {(approved || (finished && !canApprove)) && state.pulls ? (
          <Section title="Review another PR">
            {others.length === 0 ? (
              <p className="sub">No other PRs are waiting for a review.</p>
            ) : (
              <ul className="rows">
                {others.map((pr) => (
                  <Row
                    key={pr.number}
                    lead={<Mark kind="open" />}
                    title={`#${pr.number} ${pr.title}`}
                    subtitle={
                      pr.toCheck
                        ? `${pr.toCheck} to check${pr.author ? ` · ${pr.author}` : ''}`
                        : (pr.author ?? undefined)
                    }
                    href={pr.openUrl ?? pr.pageUrl ?? undefined}
                  />
                ))}
              </ul>
            )}
          </Section>
        ) : null}
        <label htmlFor={c.nameId}>Your name, shown on reports</label>
        <input
          id={c.nameId}
          type="text"
          value={c.name}
          maxLength={80}
          autoComplete="name"
          onChange={(event) => c.setName(event.target.value)}
        />
      </>
    ),
    footer: (
      <>
        {cta}
        <button type="button" className="cta plain" onClick={() => c.go({ view: 'report' })}>
          Report Issue
        </button>
      </>
    ),
  }
}

/** What a scenario checks and how it starts, before its first step. */
function briefView(c: Ctx, scenario: ChecklistScenario): Screen {
  const { checklist, state, store } = c
  const label = setUpLabel(checklist, scenario.routePath)
  const here = routeMatches(scenario.routePath, c.path)
  const settingUp = state.busy.has(`setup:${scenario.key}`)
  const start = () => c.go(startScenario(scenario, state.results))
  const leave = async () => {
    const url = await store.setUp(scenario.key)
    if (url) c.leave(url, startScenario(scenario, state.results))
  }
  const lines = scenario.setup ?? []

  let footer: ReactNode
  if (label === 'Set up') {
    footer = (
      <>
        <button type="button" className="cta" disabled={settingUp} onClick={leave}>
          {settingUp ? 'Setting up…' : 'Set Up and Start'}
        </button>
        <button type="button" className="cta plain" onClick={start}>
          Skip Setup
        </button>
      </>
    )
  } else if (label === 'Open page' && !here) {
    footer = (
      <>
        <button type="button" className="cta" disabled={settingUp} onClick={leave}>
          {settingUp ? 'Opening…' : 'Open Page and Start'}
        </button>
        <button type="button" className="cta plain" onClick={start}>
          Start Without Opening
        </button>
      </>
    )
  } else {
    footer = (
      <button type="button" className="cta" onClick={start}>
        Start
      </button>
    )
  }

  return {
    title: scenario.title,
    subtitle: checklist.walkthrough
      ? screenPosition(checklist, scenario.key)
      : plural(scenario.steps.length, 'step'),
    back: { view: 'list' },
    body: (
      <>
        {scenario.why ? <p className="lead">{scenario.why}</p> : null}
        {label === 'Set up' ? (
          <Section title="Tapthrough will">
            <Numbered
              items={
                lines.length
                  ? lines.map((line) => ({ title: line.auto }))
                  : [{ title: `Sign you in as a test user and open ${scenario.routePath}` }]
              }
            />
          </Section>
        ) : label === 'Open page' ? (
          <Section title={here ? 'You’re on its page' : 'It starts on'}>
            <p className="route">{scenario.routePath}</p>
            <p className="sub">
              {here
                ? 'Sign in with your own account if a step needs one.'
                : 'Open Page takes you there on this preview. Sign in with your own account if it asks.'}
            </p>
          </Section>
        ) : (
          <Section title="Open its page yourself">
            <p className="route">{scenario.routePath}</p>
            <p className="sub">
              This page shows one record, and this app runs without test data, so Tapthrough
              can&apos;t pick one for you. Open any, then start.
            </p>
          </Section>
        )}
        {scenario.steps.length ? (
          <Section title="You’ll check">
            <Numbered items={scenario.steps.map((s) => ({ title: s.action, detail: s.expect }))} />
          </Section>
        ) : null}
        {label === 'Set up' ? (
          <p className="caption">This signs out whoever is signed in on this preview.</p>
        ) : null}
      </>
    ),
    footer,
  }
}

/** One step: what to do, what to expect, Pass or Fail. */
function stepView(c: Ctx, scenario: ChecklistScenario, index: number): Screen {
  const { checklist, state, store } = c
  const step = scenario.steps[index]
  if (!step) return listView(c)
  const id = stepId(scenario.key, step.index)
  const result = state.results[id]
  const working = state.busy.has(id)
  const reporter = step.result?.result === result ? step.result?.reporter : null
  const onward = () => {
    const results = store.getState().results
    const next = nextOpenStep(scenario, results, index + 1)
    c.go(
      next >= 0
        ? { view: 'step', key: scenario.key, index: next }
        : afterScenario(checklist, results, scenario.key),
    )
  }
  return {
    title: scenario.title,
    subtitle: checklist.walkthrough
      ? screenPosition(checklist, scenario.key)
      : `Step ${index + 1} of ${scenario.steps.length}`,
    back: { view: 'list' },
    body: (
      <>
        <p className="action">{step.action}</p>
        <p className="expect">Expect: {step.expect}</p>
        {result === 'fail' && !step.result?.carriedFrom ? (
          <p className="caption">
            This step failed. If it works now, press Pass: the PR shows the newest result.
          </p>
        ) : null}
        {step.result?.carriedFrom && result === step.result.result ? (
          <p className="caption">
            {`${result === 'pass' ? 'Passed' : result === 'fail' ? 'Failed' : 'Skipped'} on ${step.result.carriedFrom.slice(0, 7)}. Kept because later pushes didn’t change this page.`}
          </p>
        ) : null}
        {reporter && (result === 'pass' || result === 'fail') ? (
          <p className="caption">
            {result === 'pass' ? 'Passed' : 'Failed'} by {reporter}
          </p>
        ) : null}
        {index > 0 ? (
          <button
            type="button"
            className="link prev"
            onClick={() => c.go({ view: 'step', key: scenario.key, index: index - 1 })}
          >
            Previous step
          </button>
        ) : null}
      </>
    ),
    footer: (
      <div className="pair">
        <button
          type="button"
          className={`cta gray fail ${result === 'fail' ? 'on' : ''}`}
          aria-pressed={result === 'fail'}
          aria-label={`Fail: ${step.action}`}
          disabled={working}
          onClick={() => c.go({ view: 'fail', key: scenario.key, index })}
        >
          <span aria-hidden="true">✕</span> Fail
        </button>
        <button
          type="button"
          className={`cta gray pass ${result === 'pass' ? 'on' : ''}`}
          aria-pressed={result === 'pass'}
          aria-label={`Pass: ${step.action}`}
          disabled={working}
          onClick={async () => {
            // Already passed: nothing to save, just carry on.
            if (
              result === 'pass' ||
              (await store.mark(scenario.key, step.index, 'pass', c.name || undefined))
            ) {
              onward()
            }
          }}
        >
          <span aria-hidden="true">✓</span> Pass
        </button>
      </div>
    ),
  }
}

/** The note and screenshot that go on the PR when a step fails. */
function FailForm({
  c,
  scenario,
  index,
  step,
}: {
  c: Ctx
  scenario: ChecklistScenario
  index: number
  step: ChecklistStep
}) {
  const { store, state, checklist } = c
  const [note, setNote] = useState('')
  const shot = useScreenshot(store)
  const noteId = useId()
  const working = state.busy.has(stepId(scenario.key, step.index))
  return (
    <form
      className="fill"
      onSubmit={async (event) => {
        event.preventDefault()
        const sent = await store.fail(scenario.key, step, note, {
          name: c.name || undefined,
          screenshot: shot.screenshot,
        })
        if (!sent) return
        const results = store.getState().results
        const next = nextOpenStep(scenario, results, index + 1)
        c.go(
          next >= 0
            ? { view: 'step', key: scenario.key, index: next }
            : afterScenario(checklist, results, scenario.key),
        )
      }}
    >
      <div className="body">
        <ErrorNote c={c} />
        <p className="action">{step.action}</p>
        <p className="expect">Expect: {step.expect}</p>
        <label htmlFor={noteId}>What happened instead?</label>
        <textarea
          id={noteId}
          // biome-ignore lint/a11y/noAutofocus: the reviewer just asked for this field by pressing Fail
          autoFocus
          value={note}
          onChange={(event) => setNote(event.target.value)}
          onPaste={shot.onPaste}
          placeholder="Optional, but it helps whoever fixes it"
        />
        <Attachment
          store={store}
          capture={c.capture}
          value={shot.screenshot}
          onChange={shot.setScreenshot}
        />
      </div>
      <div className="footer">
        <button type="submit" className="cta" disabled={working}>
          {working ? 'Sending…' : 'Report on the PR'}
        </button>
        <button
          type="button"
          className="cta plain"
          onClick={() => c.go({ view: 'step', key: scenario.key, index })}
        >
          Cancel
        </button>
      </div>
    </form>
  )
}

/** An issue that isn't about a step. */
function ReportForm({ c }: { c: Ctx }) {
  const { store, state } = c
  const [body, setBody] = useState('')
  const shot = useScreenshot(store)
  const bodyId = useId()
  const sending = state.busy.has('report')
  return (
    <form
      className="fill"
      onSubmit={async (event) => {
        event.preventDefault()
        const sent = await store.report(body, {
          name: c.name || undefined,
          screenshot: shot.screenshot,
        })
        if (sent) c.go({ view: 'list' })
      }}
    >
      <div className="body">
        <ErrorNote c={c} />
        <label htmlFor={bodyId}>Seen something off? It goes on the pull request.</label>
        <textarea
          id={bodyId}
          // biome-ignore lint/a11y/noAutofocus: the reviewer just asked for this field by pressing Report Issue
          autoFocus
          value={body}
          onChange={(event) => setBody(event.target.value)}
          onPaste={shot.onPaste}
        />
        <Attachment
          store={store}
          capture={c.capture}
          value={shot.screenshot}
          onChange={shot.setScreenshot}
        />
      </div>
      <div className="footer">
        <button type="submit" className="cta" disabled={sending || !body.trim()}>
          {sending ? 'Sending…' : 'Send Report'}
        </button>
      </div>
    </form>
  )
}

/** A report from an earlier push: is it fixed on this one? */
function recheckView(c: Ctx, item: RecheckItem): Screen {
  const { state, store } = c
  const verdict = state.rechecked[item.id] ?? (item.stillBrokenHere ? 'still_broken' : undefined)
  const working = state.busy.has(`recheck:${item.id}`)
  const say = async (result: 'fixed' | 'still_broken') => {
    if (await store.recheck(item.id, result, c.name || undefined)) c.go({ view: 'list' })
  }
  return {
    title: 'Re-check',
    subtitle: reportedBy(item),
    back: { view: 'list' },
    body: (
      <>
        <p className="action">“{item.excerpt}”</p>
        <p className="expect">Try it again on this preview. Is it fixed?</p>
      </>
    ),
    footer: (
      <div className="pair">
        <button
          type="button"
          className={`cta gray fail ${verdict === 'still_broken' ? 'on' : ''}`}
          aria-pressed={verdict === 'still_broken'}
          disabled={working}
          onClick={() => say('still_broken')}
        >
          <span aria-hidden="true">✕</span> Still Broken
        </button>
        <button
          type="button"
          className={`cta gray pass ${verdict === 'fixed' ? 'on' : ''}`}
          aria-pressed={verdict === 'fixed'}
          disabled={working}
          onClick={() => say('fixed')}
        >
          <span aria-hidden="true">✓</span> Fixed
        </button>
      </div>
    ),
  }
}

/** A scenario's summary once every step has a result, and where to go next. */
function doneView(c: Ctx, scenario: ChecklistScenario): Screen {
  const { checklist, state } = c
  const { results } = state
  const progress = scenarioProgress(scenario, results)
  const next = nextOpenScenario(checklist, results, scenario.key)
  const failedAt = firstFailed(scenario, results)
  const quiet = failedAt >= 0 ? ' plain' : ''
  return {
    title: scenario.title,
    subtitle: 'Checked',
    back: { view: 'list' },
    body: (
      <>
        <div className="done">
          <Mark kind={progress.failed ? 'fail' : 'pass'} large />
          <p className="big">{progress.failed ? `${progress.failed} failed` : 'All passed'}</p>
          <p className="sub">{`${progress.passed} of ${progress.total} passed`}</p>
        </div>
        {state.lastReportUrl ? (
          <p className="note" role="status">
            Report posted.{' '}
            <a href={state.lastReportUrl} target="_blank" rel="noreferrer">
              See it on the PR
            </a>
          </p>
        ) : null}
        <ul className="rows">
          {scenario.steps.map((step, index) => {
            const result = results[stepId(scenario.key, step.index)]
            return (
              <Row
                key={step.index}
                lead={<Mark kind={result === 'pass' || result === 'fail' ? result : 'open'} />}
                title={step.action}
                subtitle={
                  result === 'fail'
                    ? 'Failed · open to check it again'
                    : result === 'pass'
                      ? 'Passed'
                      : 'Not checked'
                }
                onClick={() => c.go({ view: 'step', key: scenario.key, index })}
              />
            )
          })}
        </ul>
      </>
    ),
    footer: (
      <>
        {failedAt >= 0 ? (
          <button
            type="button"
            className="cta"
            onClick={() => c.go({ view: 'step', key: scenario.key, index: failedAt })}
          >
            Check Failed Step Again
          </button>
        ) : null}
        {next ? (
          <button
            type="button"
            className={`cta${quiet}`}
            onClick={() => c.go(openScenario(next, results))}
          >
            Next: {next.title}
          </button>
        ) : (
          <button type="button" className={`cta${quiet}`} onClick={() => c.go({ view: 'list' })}>
            Finish Review
          </button>
        )}
      </>
    ),
  }
}

function ErrorNote({ c }: { c: Ctx }) {
  return c.state.error ? (
    <div className="note error" role="alert">
      <span className="grow">{c.state.error}</span>
      <button type="button" className="link" onClick={c.store.dismissError}>
        Dismiss
      </button>
    </div>
  ) : null
}

function renderView(c: Ctx, nav: Nav): Screen {
  if (nav.view === 'list' || nav.view === 'report' || nav.view === 'fail') return listView(c)
  if (nav.view === 'recheck') {
    const item = c.checklist.recheck?.find((r) => r.id === nav.id)
    return item ? recheckView(c, item) : listView(c)
  }
  const scenario = c.checklist.scenarios.find((s) => s.key === nav.key)
  if (!scenario) return listView(c)
  if (nav.view === 'brief') return briefView(c, scenario)
  if (nav.view === 'step') return stepView(c, scenario, nav.index)
  return doneView(c, scenario)
}

/** Matches `.panel`'s width in styles.ts. */
const PANEL_WIDTH = 380
/** Below this the page would be squeezed too far, so the panel lies over it instead. */
const BESIDE_MIN_WIDTH = 900

/**
 * Makes room for the open panel by narrowing the page, so the panel sits next
 * to the app instead of covering its right edge, where pages often keep their
 * main button. The page's own margin is put back when the panel closes.
 */
function useBesidePage(active: boolean) {
  useEffect(() => {
    if (!active || typeof window.matchMedia !== 'function') return
    const wide = window.matchMedia(`(min-width: ${BESIDE_MIN_WIDTH}px)`)
    const root = document.documentElement
    const before = root.style.marginRight
    const apply = () => {
      root.style.marginRight = wide.matches ? `${PANEL_WIDTH}px` : before
    }
    apply()
    wide.addEventListener('change', apply)
    return () => {
      wide.removeEventListener('change', apply)
      root.style.marginRight = before
    }
  }, [active])
}

export interface PanelProps {
  store: ReviewStore
  /** Goes to a launch link; defaults to a full page load, which the launch needs. */
  navigate?: (url: string) => void
  /** Starts open, e.g. straight after a launch. */
  defaultOpen?: boolean
  /** For tests: replaces the browser's tab capture. */
  captureTab?: () => Promise<Screenshot | null>
  /** The page the reviewer is on; defaults to `location.pathname`. */
  currentPath?: () => string | undefined
}

const pathname = () => window.location.pathname

/**
 * The floating Review button and the panel it opens: the PR's list of things
 * to check, then each one step by step, then Approve. Renders nothing off a PR build.
 */
export function Panel({
  store,
  navigate,
  defaultOpen = false,
  captureTab: capturer,
  currentPath = pathname,
}: PanelProps) {
  const state = useReview(store)
  const [open, setOpen] = useState(defaultOpen)
  const [nav, setNav] = useState<Nav>({ view: 'list' })
  // Hidden while the tab is captured, so the panel isn't in the screenshot.
  const [capturing, setCapturing] = useState(false)
  const [name, setName] = useReviewerName()
  const nameId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const titleRef = useRef<HTMLHeadingElement>(null)
  const wasOpen = useRef(defaultOpen)
  /** True once what an earlier page load left has been read, so saving can't overwrite it first. */
  const restored = useRef(false)
  /** The reviewer was mid-review before this page loaded: stay where they were. */
  const resumed = useRef(false)
  /** Whether this opening has already picked its first screen. */
  const placed = useRef(false)
  const lastNav = useRef(nav)
  const leaveTo = navigate ?? ((url: string) => window.location.assign(url))
  const ready = state.status === 'ready' && state.checklist !== null
  const pr = state.checklist?.pr
  const path = usePath(currentPath, open)

  useEffect(() => {
    void store.load()
  }, [store])

  // Remember where the reviewer is, for the next page load.
  useEffect(() => {
    if (restored.current && pr !== undefined) writeSaved({ pr, open, nav })
  }, [pr, open, nav])

  // Pick up where an earlier page load left off, e.g. after "Open Page and Start".
  useEffect(() => {
    if (!ready || restored.current) return
    restored.current = true
    const saved = readSaved()
    if (!saved || saved.pr !== pr || !saved.open) return
    resumed.current = true
    setNav(saved.nav)
    setOpen(true)
  }, [ready, pr])

  useEffect(() => {
    if (!open) {
      // Closing puts the keyboard back where it was.
      if (wasOpen.current) launcherRef.current?.focus()
      wasOpen.current = false
      placed.current = false
      return
    }
    wasOpen.current = true
    // Other reviewers' results and approvals show up without a reload.
    void store.load()
    void store.loadPulls()
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, store])

  // Opening on a page the PR has something to check on goes straight to it.
  useEffect(() => {
    if (!open || !ready || placed.current) return
    placed.current = true
    if (resumed.current) {
      resumed.current = false
      return
    }
    const { checklist, results } = store.getState()
    const here = checklist?.scenarios.find(
      (s) =>
        s.steps.length > 0 &&
        routeMatches(s.routePath, currentPath()) &&
        nextOpenStep(s, results) >= 0,
    )
    setNav((now) => (now.view === 'list' && here ? openScenario(here, results) : now))
  }, [open, ready, store, currentPath])

  // A new screen starts at its title, for a keyboard or a screen reader.
  useEffect(() => {
    if (lastNav.current === nav) return
    lastNav.current = nav
    if (open && nav.view !== 'fail' && nav.view !== 'report') titleRef.current?.focus()
  }, [nav, open])

  // Not while capturing: the screenshot shows the page at its full width.
  useBesidePage(open && !capturing && ready)

  const { checklist } = state
  if (state.status !== 'ready' || !checklist) return null

  const capture: Capture = {
    available: capturer !== undefined || canCaptureTab(),
    async tab() {
      setCapturing(true)
      try {
        // Let the panel leave the screen before the browser takes the frame.
        await new Promise((resolve) => setTimeout(resolve, 60))
        return await (capturer ?? captureTab)()
      } finally {
        setCapturing(false)
      }
    },
  }

  const badge = reviewBadge(checklist)
  const badgeText =
    badge?.kind === 'remaining'
      ? String(badge.count)
      : badge?.kind === 'failed'
        ? '!'
        : badge?.kind === 'done'
          ? '✓'
          : badge?.kind === 'new-build'
            ? 'New'
            : null
  const badgeLabel =
    badge?.kind === 'remaining'
      ? `${badge.count} to check`
      : badge?.kind === 'failed'
        ? 'a step failed'
        : badge?.kind === 'done'
          ? 'all passed'
          : badge?.kind === 'new-build'
            ? 'newer push available'
            : null

  const c: Ctx = {
    store,
    state,
    checklist,
    name,
    setName,
    nameId,
    capture,
    path,
    go: setNav,
    close: () => setOpen(false),
    leave(url, then) {
      // Saved now: the page is about to unload, before an effect could run.
      writeSaved({ pr: checklist.pr, open: true, nav: then })
      setNav(then)
      leaveTo(url)
    },
  }

  // The two forms keep what's typed while the store re-renders, so they're components.
  const failScenario =
    nav.view === 'fail' ? checklist.scenarios.find((s) => s.key === nav.key) : undefined
  const failStep = nav.view === 'fail' ? failScenario?.steps[nav.index] : undefined
  let head: Pick<Screen, 'title' | 'subtitle' | 'back'>
  let content: ReactNode
  if (nav.view === 'report') {
    head = { title: 'Report an issue', subtitle: `PR #${checklist.pr}`, back: { view: 'list' } }
    content = <ReportForm c={c} />
  } else if (nav.view === 'fail' && failScenario && failStep) {
    head = {
      title: failScenario.title,
      subtitle: `Step ${nav.index + 1} of ${failScenario.steps.length} · failed`,
      back: { view: 'step', key: nav.key, index: nav.index },
    }
    content = (
      <FailForm
        key={stepId(failScenario.key, failStep.index)}
        c={c}
        scenario={failScenario}
        index={nav.index}
        step={failStep}
      />
    )
  } else {
    const screen = renderView(c, nav)
    head = screen
    content = (
      <>
        <div className="body">
          <ErrorNote c={c} />
          {screen.body}
        </div>
        {screen.footer ? <div className="footer">{screen.footer}</div> : null}
      </>
    )
  }
  const back = head.back

  return (
    <div className="root" hidden={capturing}>
      {open ? (
        <aside className="panel" aria-label="Tapthrough review">
          <header className="head">
            {back ? (
              <button type="button" className="icon" aria-label="Back" onClick={() => setNav(back)}>
                ‹
              </button>
            ) : null}
            <div className="grow">
              <h2 ref={titleRef} tabIndex={-1}>
                {head.title}
              </h2>
              {head.subtitle ? <p className="sub">{head.subtitle}</p> : null}
            </div>
            <button
              ref={closeRef}
              type="button"
              className="icon"
              aria-label="Close review panel"
              onClick={() => setOpen(false)}
            >
              ×
            </button>
          </header>
          {content}
        </aside>
      ) : (
        <button
          ref={launcherRef}
          type="button"
          className="launcher"
          aria-label={badgeLabel ? `Review, ${badgeLabel}` : 'Review'}
          onClick={() => setOpen(true)}
        >
          Review
          {badgeText ? (
            <span className={`badge ${badge?.kind ?? ''}`} aria-hidden="true">
              {badgeText}
            </span>
          ) : null}
        </button>
      )}
    </div>
  )
}
