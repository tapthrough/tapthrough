/**
 * Reads the two things the doctor needs from a GitHub workflow file, line by
 * line: the Tapthrough step's inputs and what `on.pull_request` is limited to.
 * It is not a YAML parser. Anything it isn't sure of comes back as unknown
 * (`null` inputs, `{ kind: 'unknown' }`), never as a guess.
 */

export type WorkflowTrigger =
  /** Runs for pull requests into every branch. */
  | { kind: 'all' }
  /** Runs only for some pull requests. */
  | {
      kind: 'limited'
      branches?: string[]
      branchesIgnore?: string[]
      paths?: string[]
      pathsIgnore?: string[]
    }
  /** Has no `pull_request` trigger. */
  | { kind: 'none' }
  | { kind: 'unknown' }

export interface WorkflowInfo {
  /** The `with:` inputs of the Tapthrough step; null when they couldn't be read. */
  inputs: Record<string, string> | null
  trigger: WorkflowTrigger
  /** Whether the file grants `id-token: write`, which the Action needs. */
  idToken: boolean
}

interface Line {
  indent: number
  text: string
}

const USES = /^(?:-\s+)?uses:\s*['"]?tapthrough\/tapthrough(?:\/[^@'"\s]+)?@/
const PR_EVENT = /^['"]?(pull_request|pull_request_target)['"]?$/

/** Drops a trailing ` # comment`, leaving `#` inside quotes alone. */
function stripComment(line: string): string {
  let quote: string | null = null
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '#' && (i === 0 || /\s/.test(line[i - 1] ?? ''))) {
      return line.slice(0, i)
    }
  }
  return line
}

function toLines(text: string): Line[] {
  const lines: Line[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = stripComment(raw.replace(/\t/g, '  ')).trimEnd()
    if (line.trim() === '') continue
    lines.push({ indent: line.length - line.trimStart().length, text: line.trim() })
  }
  return lines
}

function unquote(value: string): string {
  const trimmed = value.trim()
  const quoted = /^(['"])(.*)\1$/.exec(trimmed)
  return quoted ? (quoted[2] ?? '') : trimmed
}

/** `[a, "b"]` or a single value, as a list. */
function inlineList(value: string): string[] {
  const inner = /^\[(.*)\]$/.exec(value.trim())
  if (!inner) return [unquote(value)]
  return (inner[1] ?? '')
    .split(',')
    .map(unquote)
    .filter((item) => item !== '')
}

/** `key: value` at the start of a line; the value may be empty. */
function keyValue(text: string): { key: string; value: string } | null {
  const match = /^(['"]?)([\w.-]+)\1\s*:(?:\s+(.*))?$/.exec(text)
  return match ? { key: match[2] ?? '', value: (match[3] ?? '').trim() } : null
}

/** The lines under `lines[at]`: everything after it that is indented further. */
function childrenOf(lines: Line[], at: number, indent: number): Line[] {
  const out: Line[] = []
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i] as Line
    if (line.indent <= indent) break
    out.push(line)
  }
  return out
}

/** A key's list value: inline, or `- item` lines below it. Null when it's neither. */
function listValue(lines: Line[], at: number, value: string): string[] | null {
  if (value !== '') return value.startsWith('{') ? null : inlineList(value)
  const key = lines[at] as Line
  const items: string[] = []
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i] as Line
    // A list may sit at its key's own indentation.
    if (line.indent < key.indent || !line.text.startsWith('-')) break
    items.push(unquote(line.text.replace(/^-\s*/, '')))
  }
  return items.length > 0 ? items : null
}

function hasPullRequest(events: string[]): boolean {
  return events.some((event) => PR_EVENT.test(event))
}

function readTrigger(lines: Line[]): WorkflowTrigger {
  const at = lines.findIndex((line) => line.indent === 0 && /^['"]?on['"]?\s*:/.test(line.text))
  if (at === -1) return { kind: 'unknown' }
  const on = keyValue((lines[at] as Line).text)
  if (!on) return { kind: 'unknown' }

  if (on.value !== '') {
    if (on.value.startsWith('{')) return { kind: 'unknown' }
    return hasPullRequest(inlineList(on.value)) ? { kind: 'all' } : { kind: 'none' }
  }

  const block = childrenOf(lines, at, 0)
  const first = block[0]
  if (!first) return { kind: 'unknown' }
  if (first.text.startsWith('-')) {
    const events = block.map((line) => unquote(line.text.replace(/^-\s*/, '')))
    return hasPullRequest(events) ? { kind: 'all' } : { kind: 'none' }
  }

  const eventAt = block.findIndex((line) => {
    const entry = keyValue(line.text)
    return line.indent === first.indent && entry !== null && PR_EVENT.test(entry.key)
  })
  if (eventAt === -1) return { kind: 'none' }
  const event = block[eventAt] as Line
  const eventValue = keyValue(event.text)?.value ?? ''
  if (eventValue.startsWith('{')) return { kind: 'unknown' }

  const filters = childrenOf(block, eventAt, event.indent)
  const limits: Omit<Extract<WorkflowTrigger, { kind: 'limited' }>, 'kind'> = {}
  const names = {
    branches: 'branches',
    'branches-ignore': 'branchesIgnore',
    paths: 'paths',
    'paths-ignore': 'pathsIgnore',
  } as const
  for (const [i, line] of filters.entries()) {
    const entry = keyValue(line.text)
    if (!entry || line.indent !== filters[0]?.indent) continue
    const name = names[entry.key as keyof typeof names]
    if (!name) continue
    const list = listValue(filters, i, entry.value)
    if (!list) return { kind: 'unknown' }
    limits[name] = list
  }
  return Object.keys(limits).length > 0 ? { kind: 'limited', ...limits } : { kind: 'all' }
}

function readInputs(lines: Line[]): Record<string, string> | null {
  const usesAt = lines.findIndex((line) => USES.test(line.text))
  if (usesAt === -1) return null
  const uses = lines[usesAt] as Line
  const dash = /^-\s+/.exec(uses.text)
  // The step's keys line up with `uses`; on the `- ` line that is past the dash.
  const keyIndent = uses.indent + (dash ? dash[0].length : 0)

  let start = usesAt
  if (!dash) {
    while (start > 0 && !((lines[start] as Line).indent < keyIndent)) start--
    if (!(lines[start] as Line).text.startsWith('-')) return null
  }
  let end = start + 1
  while (end < lines.length && (lines[end] as Line).indent >= keyIndent) end++

  for (let i = start; i < end; i++) {
    const line = lines[i] as Line
    const text = i === start ? line.text.replace(/^-\s+/, '') : line.text
    if (i !== start && line.indent !== keyIndent) continue
    const entry = keyValue(text)
    if (entry?.key !== 'with') continue

    if (entry.value !== '') {
      const flow = /^\{(.*)\}$/.exec(entry.value)
      // `${{ … }}` has braces and commas of its own; don't try to split around it.
      if (!flow || entry.value.includes('${{')) return null
      const inputs: Record<string, string> = {}
      for (const part of (flow[1] ?? '').split(',')) {
        if (part.trim() === '') continue
        const pair = keyValue(part.trim())
        if (!pair) return null
        inputs[pair.key] = unquote(pair.value)
      }
      return inputs
    }

    const body = lines.slice(i + 1, end).filter((l) => l.indent > keyIndent)
    const inputs: Record<string, string> = {}
    for (const child of body) {
      if (child.indent !== body[0]?.indent) continue
      const pair = keyValue(child.text)
      if (!pair) return null
      inputs[pair.key] = /^[>|][+-]?$/.test(pair.value) ? '(several lines)' : unquote(pair.value)
    }
    return inputs
  }
  return {}
}

/** Whether a workflow file has a step that runs the Tapthrough action. */
export function usesTapthroughAction(text: string): boolean {
  return toLines(text).some((line) => USES.test(line.text))
}

export function readWorkflow(text: string): WorkflowInfo {
  const lines = toLines(text)
  return {
    inputs: readInputs(lines),
    trigger: readTrigger(lines),
    idToken: lines.some(
      (line) =>
        /^id-token:\s*write$/.test(line.text) || /^permissions:\s*write-all$/.test(line.text),
    ),
  }
}
