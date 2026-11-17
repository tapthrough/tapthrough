import {
  type ChecklistScenario,
  type ChecklistStep,
  progressLabel,
  type RecheckItem,
  resetMessage,
  reviewBadge,
  stepId,
} from '@tapthrough/core'
import {
  type ClipboardEvent,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import { canCaptureTab, captureTab, fileToScreenshot, type Screenshot } from './image.js'
import { type ReviewStore, setUpLabel } from './store.js'

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

function Step({
  store,
  scenario,
  step,
  name,
  capture,
}: {
  store: ReviewStore
  scenario: ChecklistScenario
  step: ChecklistStep
  name: string
  capture: Capture
}) {
  const state = useReview(store)
  const id = stepId(scenario.key, step.index)
  const result = state.results[id]
  const working = state.busy.has(id)
  const [failing, setFailing] = useState(false)
  const [note, setNote] = useState('')
  const shot = useScreenshot(store)
  const noteId = useId()
  const reporter = step.result?.result === result ? step.result?.reporter : null

  return (
    <li className={`step ${result === 'pass' || result === 'fail' ? result : ''}`}>
      <p>{step.action}</p>
      <p className="expect">Expect: {step.expect}</p>
      {failing ? (
        <form
          onSubmit={async (event) => {
            event.preventDefault()
            const sent = await store.fail(scenario.key, step, note, {
              name: name || undefined,
              screenshot: shot.screenshot,
            })
            if (sent) {
              setFailing(false)
              setNote('')
              shot.setScreenshot(null)
            }
          }}
        >
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
            capture={capture}
            value={shot.screenshot}
            onChange={shot.setScreenshot}
          />
          <div className="actions">
            <button type="submit" className="btn primary" disabled={working}>
              {working ? 'Sending…' : 'Report on the PR'}
            </button>
            <button type="button" className="btn" onClick={() => setFailing(false)}>
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="actions">
          <button
            type="button"
            className={`btn pass ${result === 'pass' ? 'on' : ''}`}
            aria-pressed={result === 'pass'}
            disabled={working}
            onClick={() =>
              store.mark(
                scenario.key,
                step.index,
                result === 'pass' ? 'skip' : 'pass',
                name || undefined,
              )
            }
          >
            Pass
          </button>
          <button
            type="button"
            className={`btn fail ${result === 'fail' ? 'on' : ''}`}
            aria-pressed={result === 'fail'}
            disabled={working || result === 'fail'}
            onClick={() => setFailing(true)}
          >
            {result === 'fail' ? 'Failed' : 'Fail'}
          </button>
        </div>
      )}
      {reporter ? (
        <p className="who">
          {result === 'pass' ? 'Passed' : 'Failed'} by {reporter}
        </p>
      ) : null}
    </li>
  )
}

function Scenario({
  store,
  scenario,
  name,
  navigate,
  capture,
}: {
  store: ReviewStore
  scenario: ChecklistScenario
  name: string
  navigate: (url: string) => void
  capture: Capture
}) {
  const state = useReview(store)
  const settingUp = state.busy.has(`setup:${scenario.key}`)
  const label = state.checklist ? setUpLabel(state.checklist, scenario.routePath) : null
  return (
    <section className="scenario" aria-label={scenario.title}>
      <h3>{scenario.title}</h3>
      <div className="row">
        <span className="route grow">{scenario.routePath}</span>
        {label ? (
          <button
            type="button"
            className="link"
            disabled={settingUp}
            onClick={async () => {
              const url = await store.setUp(scenario.key)
              if (url) navigate(url)
            }}
          >
            {settingUp ? 'Opening…' : label}
          </button>
        ) : null}
      </div>
      {scenario.why ? <p className="why">{scenario.why}</p> : null}
      <ul className="steps">
        {scenario.steps.map((step) => (
          <Step
            key={step.index}
            store={store}
            scenario={scenario}
            step={step}
            name={name}
            capture={capture}
          />
        ))}
      </ul>
    </section>
  )
}

/** Reports from earlier commits, to check again on this preview. */
function Recheck({
  store,
  items,
  name,
}: {
  store: ReviewStore
  items: RecheckItem[]
  name: string
}) {
  const state = useReview(store)
  return (
    <section className="scenario" aria-label="Check these again">
      <h3>Check these again</h3>
      <p className="why">Reported on an earlier push. Are they fixed on this one?</p>
      <ul className="steps">
        {items.map((item) => {
          const verdict =
            state.rechecked[item.id] ?? (item.stillBrokenHere ? 'still_broken' : undefined)
          const working = state.busy.has(`recheck:${item.id}`)
          return (
            <li
              key={item.id}
              className={`step ${verdict === 'fixed' ? 'pass' : verdict ? 'fail' : ''}`}
            >
              <p>“{item.excerpt}”</p>
              <p className="expect">
                {item.reporter ?? 'A reviewer'} · {item.sha.slice(0, 7)}
              </p>
              <div className="actions">
                <button
                  type="button"
                  className={`btn pass ${verdict === 'fixed' ? 'on' : ''}`}
                  aria-pressed={verdict === 'fixed'}
                  disabled={working}
                  onClick={() => store.recheck(item.id, 'fixed', name || undefined)}
                >
                  Fixed
                </button>
                <button
                  type="button"
                  className={`btn fail ${verdict === 'still_broken' ? 'on' : ''}`}
                  aria-pressed={verdict === 'still_broken'}
                  disabled={working}
                  onClick={() => store.recheck(item.id, 'still_broken', name || undefined)}
                >
                  Still broken
                </button>
              </div>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function ReportForm({
  store,
  name,
  capture,
}: {
  store: ReviewStore
  name: string
  capture: Capture
}) {
  const state = useReview(store)
  const [body, setBody] = useState('')
  const shot = useScreenshot(store)
  const bodyId = useId()
  const sending = state.busy.has('report')
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        const sent = await store.report(body, {
          name: name || undefined,
          screenshot: shot.screenshot,
        })
        if (sent) {
          setBody('')
          shot.setScreenshot(null)
        }
      }}
    >
      <label htmlFor={bodyId}>Seen something else? It goes on the pull request.</label>
      <textarea
        id={bodyId}
        value={body}
        onChange={(event) => setBody(event.target.value)}
        onPaste={shot.onPaste}
      />
      <Attachment
        store={store}
        capture={capture}
        value={shot.screenshot}
        onChange={shot.setScreenshot}
      />
      <div className="actions">
        <button type="submit" className="btn primary" disabled={sending || !body.trim()}>
          {sending ? 'Sending…' : 'Send report'}
        </button>
      </div>
    </form>
  )
}

export interface PanelProps {
  store: ReviewStore
  /** Goes to a launch link; defaults to a full page load, which the launch needs. */
  navigate?: (url: string) => void
  /** Starts open, e.g. straight after a launch. */
  defaultOpen?: boolean
  /** For tests: replaces the browser's tab capture. */
  captureTab?: () => Promise<Screenshot | null>
}

/** The floating Review button and the panel it opens. Renders nothing off a PR build. */
export function Panel({ store, navigate, defaultOpen = false, captureTab: capturer }: PanelProps) {
  const state = useReview(store)
  const [open, setOpen] = useState(defaultOpen)
  // Hidden while the tab is captured, so the panel isn't in the screenshot.
  const [capturing, setCapturing] = useState(false)
  const [name, setName] = useReviewerName()
  const nameId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const launcherRef = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(defaultOpen)
  const go = navigate ?? ((url: string) => window.location.assign(url))

  useEffect(() => {
    void store.load()
  }, [store])

  useEffect(() => {
    if (!open) {
      // Closing puts the keyboard back where it was.
      if (wasOpen.current) launcherRef.current?.focus()
      wasOpen.current = false
      return
    }
    wasOpen.current = true
    // Other reviewers' results show up without a reload.
    void store.load()
    closeRef.current?.focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, store])

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
  const newer = checklist.newerBuild
  const recheck = checklist.recheck ?? []

  return (
    <div className="root" hidden={capturing}>
      {open ? (
        <aside className="panel" aria-label="Tapthrough review">
          <header className="head">
            <div className="grow">
              <h2>Review PR #{checklist.pr}</h2>
              <p className="sub">
                {progressLabel(state.progress)} · {checklist.sha.slice(0, 7)}
              </p>
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
          <div className="body">
            {state.error ? (
              <div className="note error" role="alert">
                <span className="grow">{state.error}</span>
                <button type="button" className="link" onClick={store.dismissError}>
                  Dismiss
                </button>
              </div>
            ) : null}
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
            {checklist.walkthrough ? <p className="note">{checklist.walkthrough.intro}</p> : null}
            {state.lastReportUrl ? (
              <p className="note" role="status">
                Report posted.{' '}
                <a href={state.lastReportUrl} target="_blank" rel="noreferrer">
                  See it on the PR
                </a>
              </p>
            ) : null}

            {recheck.length > 0 ? <Recheck store={store} items={recheck} name={name} /> : null}

            {checklist.scenarios.length === 0 ? (
              <p className="sub empty">
                This PR has no test plan yet. You can still send a report.
              </p>
            ) : null}
            {checklist.scenarios.map((scenario) => (
              <Scenario
                key={scenario.key}
                store={store}
                scenario={scenario}
                name={name}
                navigate={go}
                capture={capture}
              />
            ))}

            <div className="foot">
              <h3>Report an issue</h3>
              <ReportForm store={store} name={name} capture={capture} />
              <label htmlFor={nameId}>Your name, shown on reports</label>
              <input
                id={nameId}
                type="text"
                value={name}
                maxLength={80}
                autoComplete="name"
                onChange={(event) => setName(event.target.value)}
              />
            </div>
          </div>
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
