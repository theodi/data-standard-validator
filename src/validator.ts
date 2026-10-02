/*
 * The pipeline: JSON in, report out.
 *
 *   read -> parse -> choose @context -> skolemize -> toRDF -> SHACL -> humanise
 *
 * Isomorphic. Where the inputs come from (fetch, a file reader, a textarea)
 * is the caller's business and arrives through `Environment`.
 */

import { skolemize, type NodeLocation, type SourceMap } from './document/skolemize.js'
import { declaredContext, toDataset, type JsonLdContext } from './document/jsonld.js'
import type { ContextIndex } from './document/context-index.js'
import { createShaclValidator } from './rdf/shacl.js'
import type { CrossCheck, CrossCheckDocument } from './rdf/cross-checks.js'
import { buildIssues, documentReport } from './report/build.js'
import { emptyCounts, noteIssue } from './report/types.js'
import type { CrossCheckReport, DocumentReport, Issue, PatternHint, RunReport, Severity } from './report/types.js'
import { ContextLoader, type LoadedContext } from './load/context.js'
import { loadShapes, type LoadedShapes } from './load/shapes.js'
import { readSource, type Environment, type Source } from './load/sources.js'
import type { DatasetCore } from '@rdfjs/types'
import type { Dataset } from 'rdf-ext'

export interface ValidatorOptions extends Environment {
  /** SHACL shapes in Turtle. Several are merged, in order. */
  shapes: Source | readonly Source[]
  /** A JSON-LD context that replaces each document's own `@context`. */
  context?: Source
  /** Rules across the whole batch, run by `validateAll`. */
  crossChecks?: readonly CrossCheck[]
  /** Plain-English names for the `sh:pattern`s your shapes use. */
  patterns?: readonly PatternHint[]
  /**
   * Give anonymous nodes traceable identities so issues carry JSON paths.
   * Defaults to on, and is forced off when a shape needs real blank nodes.
   */
  skolemize?: boolean
}

export interface ValidateOptions extends ValidatorOptions {
  /** The document or documents to check. */
  data: Source | readonly Source[]
}

interface Outcome {
  report: DocumentReport
  dataset?: Dataset
}

/** Shapes loaded once, ready for any number of documents. */
export interface Validator {
  /** False when a shape needs blank nodes, so issues cannot carry JSON paths. */
  readonly skolemSafe: boolean
  /** What this validator checks against, as it appears in every report. */
  readonly setup: RunReport['setup']
  /** Check one document. */
  validate(input: Source): Promise<DocumentReport>
  /** Check a batch of documents, then run the cross-checks across all of them. */
  validateAll(inputs: readonly Source[]): Promise<RunReport>
}

// Not exported, so the published types never mention the untyped RDF libraries.
class ShaclValidator implements Validator {
  readonly skolemSafe: boolean
  readonly setup: RunReport['setup']

  private readonly engine: { validate(data: Dataset): { conforms: boolean, results: never[] } }
  private readonly useSkolem: boolean

  constructor (
    private readonly shapes: LoadedShapes,
    private readonly context: LoadedContext | undefined,
    private readonly loader: ContextLoader,
    private readonly options: ValidatorOptions,
  ) {
    this.engine = createShaclValidator(shapes.dataset) as never
    this.skolemSafe = shapes.skolemSafe
    // A shape demanding blank nodes would be broken by skolemization, so the
    // loader's finding overrides the caller.
    this.useSkolem = shapes.skolemSafe && options.skolemize !== false
    this.setup = {
      shapes: shapes.sources,
      ...(context !== undefined ? { context: context.source } : {}),
      warnings: shapes.warnings,
    }
  }

  async validate (input: Source): Promise<DocumentReport> {
    return (await this.run(input)).report
  }

  async validateAll (inputs: readonly Source[]): Promise<RunReport> {
    const documents: DocumentReport[] = []
    const crossDocs: CrossCheckDocument[] = []

    for (const input of inputs) {
      const { report, dataset } = await this.run(input)
      if (dataset) crossDocs.push({ name: report.document, dataset: dataset as unknown as DatasetCore })
      documents.push(report)
    }

    const crossChecks: CrossCheckReport[] = (this.options.crossChecks ?? []).map((check) => ({
      id: check.id,
      title: check.title,
      ...check.run(crossDocs),
    }))

    const counts = emptyCounts()
    for (const doc of documents) {
      for (const key of Object.keys(counts) as Severity[]) counts[key] += doc.counts[key]
    }

    return {
      setup: this.setup,
      documents,
      crossChecks,
      conforms: documents.every((d) => d.conforms) && crossChecks.every((c) => c.ok),
      counts,
    }
  }

  private async run (input: Source): Promise<Outcome> {
    const read = await readSource(input, this.options)
    const name = read.name

    let data: unknown
    try {
      data = read.json !== undefined ? read.json : JSON.parse(read.text ?? '')
    } catch (error) {
      // Through the same assembler as everything else: an issue that renderers
      // do not walk is an issue nobody ever sees.
      return {
        report: documentReport(name, false, [{
          severity: 'violation',
          code: 'parse-error',
          title: `This file is not valid JSON: ${(error as Error).message}`,
          hint: 'Fix the syntax first - nothing else could be checked.',
          location: { jsonPath: '$', pointer: '', document: name },
        }]),
      }
    }

    const chosen = await this.chooseContext(data, read.location)
    if ('missing' in chosen) {
      return { report: documentReport(name, false, [withDocument(chosen.missing, name)]) }
    }

    let document: unknown = data
    let index = new Map<string, NodeLocation[]>()
    let sourceMap: SourceMap | undefined
    if (this.useSkolem) {
      const result = skolemize(data, {
        ...(read.text !== undefined ? { text: read.text } : {}),
        context: chosen.index,
      })
      document = result.document
      index = result.index
      sourceMap = result.sourceMap
    }

    const dataset = await toDataset(document, chosen.context, this.loader.documentLoader)
    const shaclReport = this.engine.validate(dataset)

    const issues = buildIssues(shaclReport.results, {
      document: name,
      shapes: this.shapes.dataset,
      index,
      context: chosen.index,
      data,
      ...(sourceMap !== undefined ? { sourceMap } : {}),
      ...(this.options.patterns !== undefined ? { patterns: this.options.patterns } : {}),
    })
    if (chosen.note) issues.push(withDocument(chosen.note, name))

    return { report: documentReport(name, shaclReport.conforms, issues), dataset }
  }

  /**
   * The supplied context always wins; otherwise the document's own is loaded.
   * With neither there is nothing to turn the JSON into RDF with, and passing
   * it would mean passing a document nobody checked.
   */
  private async chooseContext (data: unknown, base: string | undefined): Promise<
    | { context: JsonLdContext, index: ContextIndex, note?: Issue }
    | { missing: Issue }
  > {
    const declared = declaredContext(data)

    if (this.context) {
      return {
        context: this.context.context,
        index: this.context.index,
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

function withDocument (issue: Issue, document: string): Issue {
  return { ...issue, location: { ...issue.location, document } }
}

const list = <T>(value: T | readonly T[]): readonly T[] =>
  Array.isArray(value) ? value : [value as T]

/** Load the shapes (and context) once; validate as many documents as you like. */
export async function createValidator (options: ValidatorOptions): Promise<Validator> {
  const loader = new ContextLoader(options)
  const shapes = await loadShapes(list(options.shapes), options)
  const context = options.context !== undefined ? await loader.load(options.context) : undefined
  return new ShaclValidator(shapes, context, loader, options)
}

/** One call: load the shapes, check the data, return the report. */
export async function validate (options: ValidateOptions): Promise<RunReport> {
  const validator = await createValidator(options)
  return validator.validateAll(list(options.data))
}
