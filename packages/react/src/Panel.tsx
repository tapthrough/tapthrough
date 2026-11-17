import {
  type ChecklistScenario,
  type ChecklistStep,
  progressLabel,
  resetMessage,
  reviewBadge,
  stepId,
} from '@tapthrough/core'
import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react'
import type { ReviewStore } from './store.js'

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

function Step({
  store,
  scenario,
  step,
  name,
}: {
  store: ReviewStore
  scenario: ChecklistScenario
  step: ChecklistStep
  name: string
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const id = stepId(scenario.key, step.index)
  const result = state.results[id]
  const working = state.busy.has(id)
  const [failing, setFailing] = useState(false)
  const [note, setNote] = useState('')
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
            if (await store.fail(scenario.key, step, note, name || undefined)) {
              setFailing(false)
              setNote('')
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
            placeholder="Optional, but it helps whoever fixes it"
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
}: {
  store: ReviewStore
  scenario: ChecklistScenario
  name: string
  navigate: (url: string) => void
}) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const settingUp = state.busy.has(`setup:${scenario.key}`)
  return (
    <section className="scenario" aria-label={scenario.title}>
      <h3>{scenario.title}</h3>
      <div className="row">
        <span className="route grow">{scenario.routePath}</span>
        <button
          type="button"
          className="link"
          disabled={settingUp}
          onClick={async () => {
            const url = await store.setUp(scenario.key)
            if (url) navigate(url)
          }}
        >
          {settingUp ? 'Setting up…' : 'Set up'}
        </button>
      </div>
      <ul className="steps">
        {scenario.steps.map((step) => (
          <Step key={step.index} store={store} scenario={scenario} step={step} name={name} />
        ))}
      </ul>
    </section>
  )
}

function ReportForm({ store, name }: { store: ReviewStore; name: string }) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const [body, setBody] = useState('')
  const bodyId = useId()
  const sending = state.busy.has('report')
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault()
        if (await store.report(body, name || undefined)) setBody('')
      }}
    >
      <label htmlFor={bodyId}>Seen something else? It goes on the pull request.</label>
      <textarea id={bodyId} value={body} onChange={(event) => setBody(event.target.value)} />
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
}

/** The floating Review button and the panel it opens. Renders nothing off a PR build. */
export function Panel({ store, navigate, defaultOpen = false }: PanelProps) {
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState)
  const [open, setOpen] = useState(defaultOpen)
  const [name, setName] = useReviewerName()
  const nameId = useId()
  const closeRef = useRef<HTMLButtonElement>(null)
  const go = navigate ?? ((url: string) => window.location.assign(url))

  useEffect(() => {
    void store.load()
  }, [store])

  // Other reviewers' results show up without a reload.
  useEffect(() => {
    if (!open) return
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

  return (
    <div className="root">
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
            {checklist.newerBuild ? (
              <p className="note">
                There&apos;s a newer push to this PR ({checklist.newerBuild.sha.slice(0, 7)}
                {checklist.newerBuild.hasFix ? ', with a fix' : ''}).{' '}
                <a href={`https://${checklist.newerBuild.updateGroupId}`}>Open its preview</a>
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

            {checklist.scenarios.length === 0 ? (
              <p className="sub">This PR has no test plan yet. You can still send a report.</p>
            ) : null}
            {checklist.scenarios.map((scenario) => (
              <Scenario
                key={scenario.key}
                store={store}
                scenario={scenario}
                name={name}
                navigate={go}
              />
            ))}

            <div className="foot">
              <h3>Report an issue</h3>
              <ReportForm store={store} name={name} />
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
        <button type="button" className="launcher" onClick={() => setOpen(true)}>
          Review
          {badgeText ? <span className={`badge ${badge?.kind ?? ''}`}>{badgeText}</span> : null}
        </button>
      )}
    </div>
  )
}
