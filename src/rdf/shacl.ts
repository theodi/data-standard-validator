/*
 * The SHACL engine, plus the one guard skolemization depends on.
 */

import SHACLValidator from 'rdf-validate-shacl'
import type { ValidationReport } from 'rdf-validate-shacl'
import type { Dataset } from 'rdf-ext'
import { rdf } from './parse.js'

const SH = 'http://www.w3.org/ns/shacl#'

export function createShaclValidator (shapes: Dataset): { validate(data: Dataset): ValidationReport } {
  // No custom factory: rdf-validate-shacl brings its own (clownface-backed)
  // environment, and handing it the rdf-ext one breaks shape traversal.
  return new SHACLValidator(shapes)
}

/**
 * Does any shape require a node to be a blank node?
 *
 * Skolemization gives every anonymous node a real IRI, which would turn such a
 * constraint from satisfied to violated. Few shapes do this - most use
 * sh:BlankNodeOrIRI, sh:IRI or sh:Literal - but any could, so this runs at
 * load time rather than living in a comment.
 */
export function requiresBlankNodes (shapes: Dataset): boolean {
  const nodeKind = rdf.namedNode(`${SH}nodeKind`)
  const blankNode = rdf.namedNode(`${SH}BlankNode`)
  for (const _quad of shapes.match(null, nodeKind, blankNode)) return true
  return false
}
