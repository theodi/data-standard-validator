/*
 * A JSON document's side of the report: where a SHACL result sits in it.
 *
 * Nodes are found through the skolemization index (every node object, named
 * or not, mapped to its JSON path), and a property one level below a node by
 * its term, through the parse tree - so an issue underlines the key the user
 * wrote, not the whole object around it.
 */

import { isSynthetic, type NodeLocation, type SourceSpan } from '../document/skolemize.js'
import type { SourceLocator } from './build.js'

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

/** Locating within a JSON document, through the skolemization index. */
export function jsonLocator (
  index: Map<string, NodeLocation[]>,
  data: unknown,
  sourceMap?: { locate (pointer: string): SourceSpan | undefined },
): SourceLocator {
  return {
    node: (iri) => index.get(iri)?.[0],
    property (node, _focus, _property, term) {
      const pointer = `${node.pointer}/${escapeSegment(term)}`
      // The property's own span is what should be underlined. When it is absent
      // there is nothing to point at, so the enclosing node's span stands.
      const span = sourceMap?.locate(pointer)
      const value = writtenValue(data, pointer)
      return {
        location: {
          ...node,
          jsonPath: node.jsonPath === '$' ? term : `${node.jsonPath}.${term}`,
          pointer,
          ...(span ?? {}),
        },
        ...(value !== undefined ? { value } : {}),
      }
    },
    // A synthetic identifier means nothing outside this process, so report
    // the node the way a reader can actually find it.
    describe: (focus, node) => isSynthetic(focus)
      ? `(anonymous node at ${node?.jsonPath ?? '$'}${
          node?.nodeId !== undefined ? `, within ${node.nodeId}` : ''})`
      : focus,
  }
}
