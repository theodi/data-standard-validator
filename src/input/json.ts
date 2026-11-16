/*
 * JSON and JSON-LD documents.
 *
 *   parse        JSON.parse; jsonc-parser says where it broke
 *   needs        a @context: the supplied one replaces the document's own
 *   name nodes   skolemize: `urn:dsv:node:N` on every node object without an @id
 *   to RDF       jsonld.toRDF
 *   issues       a note saying which context was used
 */

import { parse as parseLoosely, type ParseError } from 'jsonc-parser'
import { declaredContext, toDataset, type JsonLdContext } from '../document/jsonld.js'
import { skolemize, SourceMap } from '../document/skolemize.js'
import type { ContextIndex } from '../document/context-index.js'
import { jsonLocator } from '../report/json.js'
import { noteIssue, parseErrorIssue, type Issue } from '../report/types.js'
import type { ContextLoader, LoadedContext } from '../load/context.js'
import type { ReadResult } from '../load/sources.js'
import type { InputHandler, Preparation, PrepareSettings } from './types.js'

type ChosenContext =
  | { context: JsonLdContext, index: ContextIndex, note?: Issue }
  | { missing: Issue }

/** Where JSON.parse gave up, found by a parser that reports offsets. */
function errorPosition (text: string): { line: number, column: number } | undefined {
  const errors: ParseError[] = []
  parseLoosely(text, errors, { disallowComments: true, allowTrailingComma: false })
  const first = errors[0]
  return first !== undefined ? new SourceMap(text).position(first.offset) : undefined
}

export class JsonInput implements InputHandler {
  readonly format = 'json' as const

  constructor (
    private readonly loader: ContextLoader,
    /** The context that replaces every document's own, when one was supplied. */
    private readonly supplied: LoadedContext | undefined,
  ) {}

  async prepare (read: ReadResult, settings: PrepareSettings): Promise<Preparation> {
    let data: unknown
    try {
      data = read.json !== undefined ? read.json : JSON.parse(read.text ?? '')
    } catch (error) {
      return { failed: [parseErrorIssue('JSON', (error as Error).message, errorPosition(read.text ?? ''))] }
    }

    const chosen = await this.chooseContext(data, read.location)
    if ('missing' in chosen) return { failed: [chosen.missing] }

    // Off, nothing is named, but nodes with an @id of their own are still indexed.
    const named = skolemize(data, {
      ...(read.text !== undefined ? { text: read.text } : {}),
      context: chosen.index,
      mint: settings.skolemize,
    })

    return {
      prepared: {
        dataset: await toDataset(named.document, chosen.context, this.loader.documentLoader),
        locator: jsonLocator(named.index, data, named.sourceMap),
        naming: chosen.index,
        issues: chosen.note !== undefined ? [chosen.note] : [],
      },
    }
  }

  /**
   * The supplied context always wins; otherwise the document's own is loaded.
   * With neither there is nothing to turn the JSON into RDF with, and passing
   * it would mean passing a document nobody checked.
   */
  private async chooseContext (data: unknown, base: string | undefined): Promise<ChosenContext> {
    const declared = declaredContext(data)

    if (this.supplied) {
      return {
        context: this.supplied.context,
        index: this.supplied.index,
        note: declared === undefined
          ? noteIssue('assumed-context', 'No @context in this document, so the supplied context was used')
          : noteIssue('substituted-context', "This document's @context was replaced by the supplied context"),
      }
    }

    if (declared === undefined) {
      return {
        missing: noteIssue(
          'no-context',
          'This document has no @context, so nothing in it could be checked',
          'Add an @context to the document, or supply a context to the validator.',
        ),
      }
    }

    try {
      const context = await this.loader.inline(declared, base)
      return { context, index: this.loader.indexFor(context) }
    } catch (error) {
      return {
        // The reason names a URL, so it goes in `value`; titles and hints stay
        // free of IRIs.
        missing: {
          ...noteIssue(
            'no-context',
            "This document's @context could not be loaded, so nothing in it could be checked",
            'Check that it is reachable, or supply a context to the validator to use instead.',
          ),
          value: (error as Error).message,
        },
      }
    }
  }
}
