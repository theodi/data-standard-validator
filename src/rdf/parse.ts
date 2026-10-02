/*
 * Turtle and N-Quads in, rdf-ext dataset out.
 *
 * Carried over from the original validate.js, unchanged in behaviour: N3 does
 * the parsing, rdf-ext supplies the dataset that rdf-validate-shacl expects.
 */

import N3 from 'n3'
import rdfExt from 'rdf-ext'
import type { Dataset } from 'rdf-ext'

export const rdf = rdfExt

export function parseTurtle (text: string, baseIRI?: string): Dataset {
  const parser = baseIRI !== undefined ? new N3.Parser({ baseIRI }) : new N3.Parser()
  return rdf.dataset(parser.parse(text))
}

export function parseNQuads (text: string): Dataset {
  return rdf.dataset(new N3.Parser({ format: 'application/n-quads' }).parse(text))
}

/** Merge several Turtle documents into one dataset, in the order given. */
export function mergeTurtle (sources: { text: string, url?: string }[]): Dataset {
  const merged = rdf.dataset()
  for (const source of sources) merged.addAll(parseTurtle(source.text, source.url))
  return merged
}
