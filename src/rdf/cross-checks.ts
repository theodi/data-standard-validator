/*
 * Rules that hold across a whole set of documents, which SHACL Core cannot
 * express at all - it validates one focus node at a time.
 *
 * The library ships none; a caller passes its own (unique identifiers across
 * a batch, say) and their outcomes appear in the report next to SHACL's.
 */

import type { DatasetCore, NamedNode } from '@rdfjs/types'
import { rdf } from './parse.js'

export interface CrossCheckDocument {
  name: string
  /** The document as RDF, after its context was applied. */
  dataset: DatasetCore
}

export interface CrossCheckFinding {
  message: string
  documents: string[]
}

export interface CrossCheck {
  id: string
  /** One line describing what failed, e.g. `duplicate id across the batch`. */
  title: string
  run(documents: CrossCheckDocument[]): { ok: boolean, findings: CrossCheckFinding[] }
}

/** An IRI term, for `dataset.match()` inside a cross-check. */
export function namedNode (iri: string): NamedNode {
  return rdf.namedNode(iri) as unknown as NamedNode
}
