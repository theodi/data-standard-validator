/*
 * Turning raw SHACL results into something worth reading.
 *
 * Three translations, in order of how much they help:
 *   focus node   -> a JSON path, via the skolemization index
 *   property IRI -> the term the user wrote, via the inverted context
 *   constraint   -> a sentence, via the shape's own facts
 */

import { describeConstraint } from './messages.js'
import { shapeFacts } from './shape-facts.js'
import { isSkolemIri, type NodeLocation, type SourceMap } from '../document/skolemize.js'
import { emptyCounts, type DocumentReport, type Issue, type Location, type PatternHint, type Severity } from './types.js'
import type { ContextIndex } from '../document/context-index.js'
import type { Dataset } from 'rdf-ext'
import type { ValidationResult } from 'rdf-validate-shacl'

export interface BuildContext {
  document: string
  shapes: Dataset
  index: Map<string, NodeLocation[]>
  context?: ContextIndex
  /** The parsed document, for quoting the offending value back. */
  data: unknown
  /** Locates the *property* in the source text, not just its parent node. */
  sourceMap?: SourceMap
  patterns?: readonly PatternHint[]
}

function severityOf (result: ValidationResult): Severity {
  const value = result.severity?.value ?? ''
  if (value.endsWith('Warning')) return 'warning'
  if (value.endsWith('Info')) return 'info'
  return 'violation'
}

function escapeSegment (segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

function resolvePointer (data: unknown, pointer: string): unknown {
  if (pointer === '') return data
  let current: unknown = data
  for (const raw of pointer.split('/').slice(1)) {
    const key = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (Array.isArray(current)) current = current[Number(key)]
    else if (current !== null && typeof current === 'object') current = (current as Record<string, unknown>)[key]
    else return undefined
    if (current === undefined) return undefined
  }
  return current
}

/** The value as the user wrote it, when it is a scalar we can point at. */
function writtenValue (data: unknown, pointer: string): string | undefined {
  const value = resolvePointer(data, pointer)
  // `"x": ["XYZ"]` reads as XYZ to whoever wrote it; only collapse a single
  // entry, so we never hide that there were several.
  const scalar = Array.isArray(value) && value.length === 1 ? value[0] : value
  if (typeof scalar === 'string' || typeof scalar === 'number' || typeof scalar === 'boolean') {
    return String(scalar)
  }
  return undefined
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
    const primary = focus !== undefined ? build.index.get(focus)?.[0] : undefined

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
    if (term !== undefined && primary) {
      const pointer = `${base.pointer}/${escapeSegment(term)}`
      // The property's own span is what should be underlined. When it is absent
      // there is nothing to point at, so the enclosing node's span stands.
      const span = build.sourceMap?.locate(pointer)
      location = {
        ...base,
        jsonPath: base.jsonPath === '$' ? term : `${base.jsonPath}.${term}`,
        pointer,
        ...(span ?? {}),
      }
      value = writtenValue(build.data, pointer) ?? value
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
        // A synthetic identifier means nothing outside this process, so report
        // the node the way a reader can actually find it.
        focusNode: focus === undefined
          ? '(none)'
          : isSkolemIri(focus)
            ? `(anonymous node at ${base.jsonPath}${
                primary?.nodeId !== undefined ? `, within ${primary.nodeId}` : ''})`
            : focus,
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
