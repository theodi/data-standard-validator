/*
 * Reading the constraint back off the shape that raised it.
 *
 * rdf-validate-shacl hands us a generic message - "Less than 1 values",
 * "Value does not match pattern ..." - because the generated shapes declare no
 * `sh:message` of their own (verified: zero across the published shapes). What
 * they *do* declare is plenty of `sh:description`s, plus the constraint
 * parameters themselves. Going back to the source shape and reading
 * `sh:description`, `sh:minCount`, `sh:in` and friends is what lets us say
 * "must be one of: usual, official, temp" instead of quoting four IRIs.
 */

import { rdf } from '../rdf/parse.js'
import type { Dataset } from 'rdf-ext'
import type { Term } from 'n3'

const SH = 'http://www.w3.org/ns/shacl#'
const RDF_FIRST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#first'
const RDF_REST = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#rest'
const RDF_NIL = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#nil'

export interface ShapeFacts {
  description?: string
  name?: string
  message?: string
  path?: string
  minCount?: number
  maxCount?: number
  pattern?: string
  flags?: string
  datatype?: string
  nodeKind?: string
  klass?: string
  minInclusive?: string
  maxInclusive?: string
  minExclusive?: string
  maxExclusive?: string
  /** Members of `sh:in`, in declaration order. */
  in?: string[]
}

function one (shapes: Dataset, subject: Term, predicate: string): string | undefined {
  for (const quad of shapes.match(subject, rdf.namedNode(SH + predicate), null)) {
    return quad.object.value
  }
  return undefined
}

function num (shapes: Dataset, subject: Term, predicate: string): number | undefined {
  const value = one(shapes, subject, predicate)
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/** Walk an RDF collection (`sh:in` is one) into a plain array. */
function readList (shapes: Dataset, head: Term): string[] {
  const out: string[] = []
  let node: Term | undefined = head
  const guard = new Set<string>()
  while (node && node.value !== RDF_NIL) {
    if (guard.has(node.value)) break // malformed, cyclic list
    guard.add(node.value)
    let first: Term | undefined
    for (const quad of shapes.match(node, rdf.namedNode(RDF_FIRST), null)) { first = quad.object; break }
    if (first) out.push(first.value)
    let rest: Term | undefined
    for (const quad of shapes.match(node, rdf.namedNode(RDF_REST), null)) { rest = quad.object; break }
    node = rest
  }
  return out
}

export function shapeFacts (shapes: Dataset, sourceShape: Term | null): ShapeFacts {
  if (!sourceShape) return {}
  const facts: ShapeFacts = {}

  const assignString = (key: keyof ShapeFacts, predicate: string): void => {
    const value = one(shapes, sourceShape, predicate)
    if (value !== undefined) (facts as Record<string, unknown>)[key] = value
  }

  assignString('description', 'description')
  assignString('name', 'name')
  assignString('message', 'message')
  assignString('path', 'path')
  assignString('pattern', 'pattern')
  assignString('flags', 'flags')
  assignString('datatype', 'datatype')
  assignString('nodeKind', 'nodeKind')
  assignString('klass', 'class')
  assignString('minInclusive', 'minInclusive')
  assignString('maxInclusive', 'maxInclusive')
  assignString('minExclusive', 'minExclusive')
  assignString('maxExclusive', 'maxExclusive')

  const minCount = num(shapes, sourceShape, 'minCount')
  if (minCount !== undefined) facts.minCount = minCount
  const maxCount = num(shapes, sourceShape, 'maxCount')
  if (maxCount !== undefined) facts.maxCount = maxCount

  for (const quad of shapes.match(sourceShape, rdf.namedNode(`${SH}in`), null)) {
    facts.in = readList(shapes, quad.object)
    break
  }

  return facts
}
