/*
 * Giving every node in the input document a name we can trace back.
 *
 * SHACL reports point at *RDF nodes*. Most nodes in a JSON-LD document have no
 * `@id`, so they arrive as blank nodes - and `jsonld.toRDF` mints its own
 * `_:b0`, `_:b1` labels during conversion, which correspond to nothing the
 * user wrote. That is why the old validator could only ever print
 * `focus: _:b3`, leaving people to guess which of eight nested objects was
 * wrong.
 *
 * The fix is to name them ourselves, *before* conversion: walk the document,
 * inject `"@id": "urn:dsv:node:<n>"` into every node object that lacks one,
 * and remember where each URN came from. Afterwards every focus node in the
 * report is either an `@id` the user wrote or a URN that decodes straight back
 * to `requirements.culturalNeeds`.
 *
 * This is safe because it adds no triples: `@id` is the node's identity, not a
 * property. Counting constraints, `sh:closed` and `sh:ignoredProperties` are
 * all unaffected. The one thing it *would* break is a shape asserting
 * `sh:nodeKind sh:BlankNode`; most shapes use
 * `sh:BlankNodeOrIRI`, `sh:IRI` or `sh:Literal` instead, and `loadShapes` scans for
 * it and turns skolemization off if one ever appears.
 */

import { parseTree, findNodeAtLocation, type Node as JsoncNode } from 'jsonc-parser'
import type { ContextIndex } from './context-index.js'

export const SKOLEM_PREFIX = 'urn:dsv:node:'

export interface NodeLocation {
  /** Dotted path as a person would read it: `address[0].postcode`. */
  jsonPath: string
  /** RFC 6901 JSON Pointer: `/address/0/postcode`. */
  pointer: string
  /** `@type` as written in the document, e.g. `Address`. */
  nodeType?: string
  /** Nearest `@id` on this node or an ancestor - the user's own handle on it. */
  nodeId?: string
  line?: number
  column?: number
  endLine?: number
  endColumn?: number
}

export interface SkolemizeResult {
  /** A copy of the document with synthetic `@id`s injected. */
  document: unknown
  /** Node IRI (real or synthetic) -> everywhere it appears. */
  index: Map<string, NodeLocation[]>
  /** How many synthetic identifiers were minted. */
  minted: number
  /** Locates any pointer in the original text; absent when no text was given. */
  sourceMap?: SourceMap
}

/** Containers whose object level is a map of entries, not a node. */
const MAP_CONTAINERS = new Set(['@index', '@language', '@id', '@type'])

function isPlainObject (v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function escapePointer (segment: string): string {
  return segment.replace(/~/g, '~0').replace(/\//g, '~1')
}

export interface SkolemizeOptions {
  /** Original text, when available - unlocks line/column on every location. */
  text?: string
  /** Used to spot map-valued containers and resolve `@type` to a class IRI. */
  context?: ContextIndex
}

/**
 * Walk `input`, naming anonymous nodes and recording where each node sits.
 *
 * The input is not mutated; `document` in the result is a fresh structure.
 */
export function skolemize (input: unknown, opts: SkolemizeOptions = {}): SkolemizeResult {
  const index = new Map<string, NodeLocation[]>()
  let counter = 0

  const sourceMap = opts.text !== undefined ? new SourceMap(opts.text) : undefined

  const locate = (segments: (string | number)[]): Partial<NodeLocation> =>
    sourceMap?.locateSegments(segments) ?? {}

  const record = (iri: string, loc: NodeLocation): void => {
    const existing = index.get(iri)
    if (existing) existing.push(loc)
    else index.set(iri, [loc])
  }

  interface Frame {
    jsonPath: string
    pointer: string
    segments: (string | number)[]
    nodeId?: string
    /** Class IRI of the enclosing node, for type-scoped term lookups. */
    typeIri?: string
    /** Term definition of the key that led here. */
    containers?: string[]
  }

  const walk = (value: unknown, frame: Frame): unknown => {
    if (Array.isArray(value)) {
      return value.map((item, i) => walk(item, {
        ...frame,
        jsonPath: `${frame.jsonPath}[${i}]`,
        pointer: `${frame.pointer}/${i}`,
        segments: [...frame.segments, i],
      }))
    }

    if (!isPlainObject(value)) return value

    // A value object (`{"@value": ...}`) is a literal in disguise, never a node.
    if ('@value' in value) return { ...value }

    // `@list` / `@set` wrappers hold the real items one level down.
    if ('@list' in value || '@set' in value) {
      const out: Record<string, unknown> = { ...value }
      for (const key of ['@list', '@set'] as const) {
        if (key in value) out[key] = walk(value[key], { ...frame, segments: [...frame.segments, key] })
      }
      return out
    }

    // An `@index` / `@language` / `@id` container puts a plain map here, whose
    // *values* are the nodes. Few contexts use one,
    // but mis-pathing silently would be worse than the extra branch.
    if (frame.containers?.some((c) => MAP_CONTAINERS.has(c))) {
      const out: Record<string, unknown> = {}
      for (const [k, v] of Object.entries(value)) {
        out[k] = walk(v, {
          ...frame,
          jsonPath: `${frame.jsonPath}.${k}`,
          pointer: `${frame.pointer}/${escapePointer(k)}`,
          segments: [...frame.segments, k],
          containers: [],
        })
      }
      return out
    }

    // Everything left is a node object.
    const out: Record<string, unknown> = { ...value }
    const declaredId = typeof value['@id'] === 'string' ? value['@id'] as string : undefined
    let iri = declaredId
    if (iri === undefined) {
      iri = `${SKOLEM_PREFIX}${counter++}`
      out['@id'] = iri
    }

    const rawType = value['@type']
    const typeName = typeof rawType === 'string'
      ? rawType
      : Array.isArray(rawType) && typeof rawType[0] === 'string' ? rawType[0] as string : undefined
    const typeIri = typeName !== undefined && opts.context
      ? opts.context.expand(typeName)
      : undefined

    const nodeId = declaredId ?? frame.nodeId

    const loc: NodeLocation = {
      jsonPath: frame.jsonPath === '' ? '$' : frame.jsonPath,
      pointer: frame.pointer === '' ? '' : frame.pointer,
      ...locate(frame.segments),
    }
    if (typeName !== undefined) loc.nodeType = typeName
    if (nodeId !== undefined) loc.nodeId = nodeId
    record(iri, loc)
    // Index the expanded form too, so a report quoting the absolute IRI still
    // finds the node when the document wrote it compactly (`ex:person-1`).
    if (declaredId !== undefined && opts.context) {
      const expanded = opts.context.expand(declaredId)
      if (expanded !== declaredId) record(expanded, loc)
    }

    for (const [key, child] of Object.entries(value)) {
      if (key === '@id' || key === '@type' || key === '@context') continue
      const def = key.startsWith('@') ? undefined : opts.context?.termDef(key, typeIri)
      const childFrame: Frame = {
        jsonPath: frame.jsonPath === '' ? key : `${frame.jsonPath}.${key}`,
        pointer: `${frame.pointer}/${escapePointer(key)}`,
        segments: [...frame.segments, key],
        containers: def?.container ?? [],
      }
      if (nodeId !== undefined) childFrame.nodeId = nodeId
      if (typeIri !== undefined) childFrame.typeIri = typeIri
      out[key] = walk(child, childFrame)
    }
    return out
  }

  const document = walk(input, { jsonPath: '', pointer: '', segments: [] })
  return {
    document,
    index,
    minted: counter,
    ...(sourceMap !== undefined ? { sourceMap } : {}),
  }
}

export function isSkolemIri (iri: string): boolean {
  return iri.startsWith(SKOLEM_PREFIX)
}

export interface SourceSpan {
  line: number
  column: number
  endLine: number
  endColumn: number
}

function decodeSegment (segment: string): string {
  return segment.replace(/~1/g, '/').replace(/~0/g, '~')
}

export class SourceMap {
  private readonly tree: JsoncNode | undefined
  private readonly lineStarts: number[]

  constructor (text: string) {
    this.tree = parseTree(text)
    this.lineStarts = [0]
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) this.lineStarts.push(i + 1)
    }
  }

  private lineCol (offset: number): { line: number, column: number } {
    let lo = 0
    let hi = this.lineStarts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (this.lineStarts[mid]! <= offset) lo = mid
      else hi = mid - 1
    }
    return { line: lo + 1, column: offset - this.lineStarts[lo]! + 1 }
  }

  /** Locate by pre-split path segments (what the walker already has). */
  locateSegments (segments: (string | number)[]): SourceSpan | undefined {
    if (!this.tree) return undefined
    const node = findNodeAtLocation(this.tree, segments)
    if (!node) return undefined
    const start = this.lineCol(node.offset)
    const end = this.lineCol(node.offset + node.length)
    return {
      line: start.line,
      column: start.column,
      endLine: end.line,
      endColumn: end.column,
    }
  }

  /** Locate by RFC 6901 pointer, e.g. `/address/0/postcode`. */
  locate (pointer: string): SourceSpan | undefined {
    if (pointer === '') return this.locateSegments([])
    const segments = pointer.split('/').slice(1).map((raw) => {
      const decoded = decodeSegment(raw)
      return /^\d+$/.test(decoded) ? Number(decoded) : decoded
    })
    return this.locateSegments(segments)
  }
}
