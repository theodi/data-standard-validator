/*
 * Turning raw SHACL results into something worth reading.
 *
 * Three translations, in order of how much they help:
 *   focus node   -> a place in the source, via the format's SourceLocator
 *   property IRI -> the term the user wrote, via the inverted context
 *   constraint   -> a sentence, via the shape's own facts
 */

import { describeConstraint } from './messages.js'
import { shapeFacts } from './shape-facts.js'
import { emptyCounts, type DocumentReport, type Issue, type Location, type PatternHint, type Severity } from './types.js'
import type { ContextIndex } from '../document/context-index.js'
import type { Dataset } from 'rdf-ext'
import type { ValidationResult } from 'rdf-validate-shacl/src/validation-report.js'

/**
 * Where things are in the document, whatever syntax it was written in. Each
 * input format supplies one: JSON answers through the skolemization index and
 * the parse tree (report/json.ts), CSV through the cells each triple came
 * from (report/csv.ts).
 */
export interface SourceLocator {
  /** Where a focus node is written, if it came from the document. */
  node (iri: string): Omit<Location, 'document'> | undefined
  /** The property one level below a located node, and its value as written. */
  property (
    node: Omit<Location, 'document'>, focusIri: string, propertyIri: string, term: string,
  ): { location: Omit<Location, 'document'>, value?: string }
  /** The focus node as `technical.focusNode` shows it. */
  describe (focusIri: string, node: Omit<Location, 'document'> | undefined): string
}

export interface BuildContext {
  document: string
  shapes: Dataset
  locator: SourceLocator
  context?: ContextIndex
  patterns?: readonly PatternHint[]
}

function severityOf (result: ValidationResult): Severity {
  const value = result.severity?.value ?? ''
  if (value.endsWith('Warning')) return 'warning'
  if (value.endsWith('Info')) return 'info'
  return 'violation'
}

/** An IRI value shown as the token or term a user would recognise. */
function displayIri (
  raw: string | undefined, ctx: ContextIndex | undefined,
  propertyIri: string | undefined, typeIri: string | undefined,
): string | undefined {
  if (raw === undefined) return undefined
  if (ctx && /^https?:\/\//.test(raw)) {
    return (propertyIri !== undefined ? ctx.tokenFor(raw, propertyIri, typeIri) : undefined)
      ?? ctx.termFor(raw, typeIri)
      ?? ctx.compact(raw)
  }
  return raw
}

export function buildIssues (results: ValidationResult[], build: BuildContext): Issue[] {
  const issues: Issue[] = []

  for (const result of results) {
    const focus = result.focusNode?.value
    const primary = focus !== undefined ? build.locator.node(focus) : undefined

    const propertyIri = result.path?.value
    const typeIri = primary?.nodeType !== undefined && build.context
      ? build.context.expand(primary.nodeType)
      : undefined
    const term = propertyIri !== undefined && build.context
      ? build.context.termFor(propertyIri, typeIri)
      : undefined

    const facts = shapeFacts(build.shapes, result.sourceShape)
    const constraint = result.sourceConstraintComponent?.value.split('#').pop() ?? 'Unknown'

    // Permitted values, rendered as the tokens a user would type.
    let allowedValues: string[] | undefined
    if (facts.in) {
      const tokens = propertyIri !== undefined
        ? build.context?.tokensFor(propertyIri, typeIri)
        : undefined
      allowedValues = facts.in.map((iri) =>
        tokens?.get(iri) ?? build.context?.termFor(iri, typeIri) ?? build.context?.compact(iri) ?? iri)
    }

    const base: Location = primary
      ? { ...primary, document: build.document }
      : { jsonPath: '$', pointer: '', document: build.document }

    // The issue belongs at the property, one level below the focus node.
    let location = base
    let value = displayIri(result.value?.value, build.context, propertyIri, typeIri)
    if (term !== undefined && primary && focus !== undefined && propertyIri !== undefined) {
      const located = build.locator.property(primary, focus, propertyIri, term)
      location = { ...located.location, document: build.document }
      value = located.value ?? value
    }

    const message = describeConstraint({
      constraint,
      term,
      facts,
      value,
      ...(allowedValues !== undefined ? { allowedValues } : {}),
      ...(build.patterns !== undefined ? { patterns: build.patterns } : {}),
    })

    issues.push({
      severity: severityOf(result),
      code: message.code,
      title: message.title,
      ...(message.hint !== undefined ? { hint: message.hint } : {}),
      location,
      ...(term !== undefined && propertyIri !== undefined ? { field: { term, iri: propertyIri } } : {}),
      ...(value !== undefined ? { value } : {}),
      ...(allowedValues !== undefined ? { allowedValues } : {}),
      technical: {
        focusNode: focus === undefined ? '(none)' : build.locator.describe(focus, primary),
        ...(propertyIri !== undefined ? { resultPath: propertyIri } : {}),
        ...(result.sourceShape ? { sourceShape: result.sourceShape.value } : {}),
        constraint,
      },
    })
  }

  return dedupe(issues)
}

/**
 * One mistake often trips several constraints at once - an out-of-vocabulary
 * value fails `sh:in` and `sh:class` together. Showing both trains people to
 * ignore the output, so the specific complaint wins.
 */
function dedupe (issues: Issue[]): Issue[] {
  const slots = new Map<string, Issue[]>()
  for (const issue of issues) {
    const slot = `${issue.location.pointer}|${issue.value ?? ''}`
    const bucket = slots.get(slot)
    if (bucket) bucket.push(issue)
    else slots.set(slot, [issue])
  }

  const dropped = new Set<Issue>()
  for (const bucket of slots.values()) {
    if (bucket.length < 2) continue
    if (!bucket.some((i) => i.code === 'value-not-allowed' || i.code === 'bad-format')) continue
    for (const issue of bucket) {
      if (issue.code === 'wrong-type' || issue.code === 'wrong-object-type') dropped.add(issue)
    }
  }
  return issues.filter((issue) => !dropped.has(issue))
}

/**
 * The issues found while converting a document, followed by SHACL's. A value
 * the conversion could not read has been reported already, in the format's
 * own words; what SHACL makes of the leftover text (wrong type, out of range)
 * only repeats it less clearly, so it is dropped.
 */
export function combineIssues (conversion: Issue[], shacl: Issue[]): Issue[] {
  const unreadable = new Set(conversion.filter((i) => i.code === 'bad-format').map((i) => i.location.pointer))
  return [...conversion, ...shacl.filter((i) => !unreadable.has(i.location.pointer))]
}

const SEVERITY_ORDER: Record<Severity, number> = { violation: 0, warning: 1, info: 2 }

export function documentReport (
  document: string, conforms: boolean, issues: Issue[],
): DocumentReport {
  const sorted = [...issues].sort((a, b) =>
    SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
    (a.location.line ?? 0) - (b.location.line ?? 0))
  const counts = emptyCounts()
  for (const issue of sorted) counts[issue.severity]++
  return { document, conforms, counts, issues: sorted }
}
