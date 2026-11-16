/*
 * What every input format does for the pipeline.
 *
 * A format's job ends where SHACL's begins: turn the document's text into an
 * RDF dataset, and say how to find any node or property of that dataset back
 * in the text. Everything after - the engine, the wording, the report - is
 * shared, which is what keeps the formats reporting alike.
 *
 * The stages are the same for each format, only the means differ:
 *
 *   parse        the syntax, failing with `parse-error` at the line it broke
 *   needs        what the conversion cannot do without (a JSON-LD context,
 *                CSVW metadata), failing rather than passing unchecked
 *   name nodes   give every node an identity that maps back to the source
 *                (skolemization)
 *   to RDF       the conversion proper
 *   issues       what the conversion itself found wrong, in the format's terms
 */

import type { ContextIndex } from '../document/context-index.js'
import type { SourceLocator } from '../report/build.js'
import type { Issue } from '../report/types.js'
import type { InputFormat, ReadResult } from '../load/sources.js'
import type { Dataset } from 'rdf-ext'

export interface Prepared {
  /** What the shapes check. */
  dataset: Dataset
  /** Takes a SHACL result back to the place in the source it is about. */
  locator: SourceLocator
  /** Names IRIs the way this document writes them: terms, tokens, column titles. */
  naming?: ContextIndex
  /** Found before SHACL ran: notes, header problems, unreadable values. */
  issues: Issue[]
}

/** `failed`: the document could not be checked at all, and these say why. */
export type Preparation = { prepared: Prepared } | { failed: Issue[] }

export interface PrepareSettings {
  /** Name anonymous nodes so issues can be located; off when a shape needs blank nodes. */
  skolemize: boolean
}

export interface InputHandler {
  readonly format: InputFormat
  prepare (read: ReadResult, settings: PrepareSettings): Promise<Preparation>
}
