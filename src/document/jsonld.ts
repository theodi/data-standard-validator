/*
 * Getting a JSON-LD document into RDF, with a context chosen by the caller.
 *
 * Which context applies is decided before this point (see `validator.ts`);
 * here it is only put in place. Remote contexts referenced from *inside* a
 * context are resolved through the document loader the caller passes, so the
 * same fetch, file reader and cache serve everything - and without one, every
 * remote lookup is refused rather than made behind the caller's back.
 */

import jsonld from 'jsonld'
import { parseNQuads } from '../rdf/parse.js'
import type { Dataset } from 'rdf-ext'

export type JsonLdContext = Record<string, unknown> | unknown[]

/** What jsonld.js expects back from a document loader. */
export interface RemoteDocument {
  contextUrl: null
  documentUrl: string
  document: unknown
}

export type DocumentLoader = (url: string) => Promise<RemoteDocument>

function isPlainObject (value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/** Unwrap `{"@context": {...}}`, which is how context files are written. */
export function unwrapContext (parsed: unknown): unknown {
  if (isPlainObject(parsed) && '@context' in parsed) return parsed['@context']
  return parsed
}

/** The `@context` the document itself declares, if any. */
export function declaredContext (doc: unknown): unknown {
  return isPlainObject(doc) ? doc['@context'] : undefined
}

const refuse: DocumentLoader = async (url) => {
  throw new Error(`refusing to fetch ${url} while converting the document`)
}

/**
 * Convert a JSON-LD document to RDF. A `context`, when given, replaces
 * whatever the document declared.
 */
export async function toDataset (
  doc: unknown,
  context: JsonLdContext | undefined,
  documentLoader: DocumentLoader = refuse,
): Promise<Dataset> {
  let input = doc
  if (context !== undefined) {
    // A top-level array has nowhere to hold a context, so it becomes a graph;
    // the nodes keep the identities skolemization gave them.
    input = isPlainObject(doc)
      ? { ...doc, '@context': context }
      : { '@context': context, '@graph': doc }
  }

  const nquads = await jsonld.toRDF(input, {
    format: 'application/n-quads',
    documentLoader,
  }) as unknown as string

  return parseNQuads(nquads)
}
