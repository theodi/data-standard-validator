/*
 * What a report is.
 *
 * This is the published contract: `--format json` emits it verbatim and web
 * pages render it, so treat a change here as breaking.
 *
 * Every issue has two layers. The human one - title, hint, jsonPath, allowed
 * values - never contains a raw IRI and is safe to show to anyone. `technical`
 * is the escape hatch for people who do know SHACL, and what makes a bug report
 * against this tool actionable.
 */

export type Severity = 'violation' | 'warning' | 'info'

export type IssueCode =
  | 'required-field-missing'
  | 'too-few-values'
  | 'too-many-values'
  | 'value-not-allowed'
  | 'bad-format'
  | 'wrong-type'
  | 'wrong-object-type'
  | 'out-of-range'
  | 'rule-violation'
  | 'assumed-context'
  | 'substituted-context'
  | 'no-context'
  | 'parse-error'
  | 'shape-unavailable'
  | 'other'

export interface Location {
  /** `address[0].postcode`, or `$` for the document root. */
  jsonPath: string
  /** RFC 6901 pointer for the same place. */
  pointer: string
  /** `@type` as written, e.g. `Address`. */
  nodeType?: string
  /** Nearest `@id` the user wrote, on this node or an ancestor. */
  nodeId?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
  /** File name, when several documents are validated together. */
  document?: string
}

export interface Issue {
  severity: Severity
  code: IssueCode
  /** One line, plain English, never an IRI. */
  title: string
  /** What to do about it. */
  hint?: string
  location: Location
  /** The field this is about, as the user writes it. */
  field?: { term: string, iri: string }
  /** The offending value, as the user wrote it where we can see it. */
  value?: string
  /** Permitted values for a controlled vocabulary, as tokens. */
  allowedValues?: string[]
  technical?: {
    focusNode: string
    resultPath?: string
    sourceShape?: string
    constraint: string
  }
}

export interface DocumentReport {
  document: string
  conforms: boolean
  counts: Record<Severity, number>
  issues: Issue[]
}

/** The outcome of one multi-document rule (see `CrossCheck`). */
export interface CrossCheckReport {
  id: string
  title: string
  ok: boolean
  findings: { message: string, documents: string[] }[]
}

export interface RunReport {
  /** What the documents were checked against. */
  setup: {
    /** Where each shapes file came from, in the order they were merged. */
    shapes: string[]
    /** The context supplied to the validator, if any. */
    context?: string
    /** Anything odd about the setup, e.g. an optional shape that is missing. */
    warnings: Issue[]
  }
  documents: DocumentReport[]
  crossChecks: CrossCheckReport[]
  conforms: boolean
  counts: Record<Severity, number>
}

export function emptyCounts (): Record<Severity, number> {
  return { violation: 0, warning: 0, info: 0 }
}

/**
 * A plain-English name for an `sh:pattern`.
 *
 * `pattern` is either the exact regex source as written in the shape, or a
 * RegExp tested against that source.
 */
export interface PatternHint {
  pattern: string | RegExp
  /** Completes "It should be ...", e.g. `a UK postcode in upper case`. */
  description: string
  example?: string
}

/** Severity of the issues the validator raises itself, outside SHACL. */
const NOTE_SEVERITY: Partial<Record<IssueCode, Severity>> = {
  'shape-unavailable': 'warning',
  'no-context': 'violation',
}

export function noteIssue (code: IssueCode, title: string, hint?: string): Issue {
  return {
    severity: NOTE_SEVERITY[code] ?? 'info',
    code,
    title,
    ...(hint !== undefined ? { hint } : {}),
    location: { jsonPath: '$', pointer: '' },
  }
}
