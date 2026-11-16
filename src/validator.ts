/*
 * The pipeline: any input format in, report out.
 *
 *   read -> prepare (format's own: parse, name nodes, convert) -> SHACL -> humanise
 *
 * Everything format-specific sits behind `InputHandler` (src/input/); from
 * the dataset onwards a JSON-LD record and a CSV file take the same road, so
 * they are checked and reported alike.
 *
 * Isomorphic. Where the inputs come from (fetch, a file reader, a textarea)
 * is the caller's business and arrives through `Environment`.
 */

import { createShaclValidator } from './rdf/shacl.js'
import type { CrossCheck, CrossCheckDocument } from './rdf/cross-checks.js'
import { buildIssues, combineIssues, documentReport } from './report/build.js'
import { emptyCounts } from './report/types.js'
import type { CrossCheckReport, DocumentReport, Issue, PatternHint, RunReport, Severity } from './report/types.js'
import { ContextLoader, type LoadedContext } from './load/context.js'
import { loadShapes, type LoadedShapes } from './load/shapes.js'
import { loadCsvw, type LoadedCsvw } from './load/csvw.js'
import { formatOf, readSource, type Environment, type InputFormat, type Source } from './load/sources.js'
import { createInputs, type InputHandler } from './input/index.js'
import type { Dataset } from 'rdf-ext'

export interface ValidatorOptions extends Environment {
  /** SHACL shapes in Turtle. Several are merged, in order. */
  shapes: Source | readonly Source[]
  /** A JSON-LD context that replaces each document's own `@context`. */
  context?: Source
  /**
   * CSVW metadata describing how CSV documents map to RDF. Needed only to
   * validate CSV; a CSV document without it fails with `no-csv-metadata`.
   */
  csvMetadata?: Source
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

  private readonly engine: ReturnType<typeof createShaclValidator>
  private readonly useSkolem: boolean
  private readonly inputs: Record<InputFormat, InputHandler>

  constructor (
    private readonly shapes: LoadedShapes,
    context: LoadedContext | undefined,
    loader: ContextLoader,
    private readonly options: ValidatorOptions,
    csv: LoadedCsvw | undefined,
  ) {
    this.engine = createShaclValidator(shapes.dataset)
    this.inputs = createInputs({
      loader,
      ...(context !== undefined ? { context } : {}),
      ...(csv !== undefined ? { csv } : {}),
    })
    this.skolemSafe = shapes.skolemSafe
    // A shape demanding blank nodes would be broken by skolemization, so the
    // loader's finding overrides the caller.
    this.useSkolem = shapes.skolemSafe && options.skolemize !== false
    this.setup = {
      shapes: shapes.sources,
      ...(context !== undefined ? { context: context.source } : {}),
      ...(csv !== undefined ? { csvMetadata: csv.source } : {}),
      warnings: [...shapes.warnings, ...(csv?.warnings ?? [])],
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
      if (dataset) crossDocs.push({ name: report.document, dataset })
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
    const preparation = await this.inputs[formatOf(read)].prepare(read, { skolemize: this.useSkolem })
    if ('failed' in preparation) {
      return { report: documentReport(name, false, preparation.failed.map((i) => withDocument(i, name))) }
    }

    const { dataset, locator, naming, issues: found } = preparation.prepared
    const shaclReport = await this.engine.validate(dataset)
    const shaclIssues = buildIssues(shaclReport.results, {
      document: name,
      shapes: this.shapes.dataset,
      locator,
      ...(naming !== undefined ? { context: naming } : {}),
      ...(this.options.patterns !== undefined ? { patterns: this.options.patterns } : {}),
    })

    const issues = combineIssues(found, shaclIssues).map((i) => withDocument(i, name))
    // What the conversion found counts as much as what SHACL found.
    const conforms = shaclReport.conforms && !found.some((i) => i.severity === 'violation')
    return { report: documentReport(name, conforms, issues), dataset }
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
  const csv = options.csvMetadata !== undefined ? await loadCsvw(options.csvMetadata, options) : undefined
  return new ShaclValidator(shapes, context, loader, options, csv)
}

/** One call: load the shapes, check the data, return the report. */
export async function validate (options: ValidateOptions): Promise<RunReport> {
  const validator = await createValidator(options)
  return validator.validateAll(list(options.data))
}
