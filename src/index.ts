/*
 * Public API - the browser-safe build.
 *
 * Nothing here touches the filesystem, so the same code serves bundlers and
 * the browser. Node gets `./node.ts` instead (via the package's `exports`),
 * which is this plus file paths.
 */

export { createValidator, validate } from './validator.js'
export type { Validator, ValidatorOptions, ValidateOptions } from './validator.js'

export { readSource, isUrl } from './load/sources.js'
export type { Source, Environment, ReadFile, ReadResult } from './load/sources.js'
export { SourceError, NotFoundError } from './load/fetch.js'
export type { Fetch } from './load/fetch.js'

export { formatReport, renderText, renderJson, renderMarkdown, FORMATS } from './format/index.js'
export type { Format, FormatOptions } from './format/index.js'

export { groupIssues } from './report/group.js'
export type { IssueGroup } from './report/group.js'
export type {
  PatternHint, Issue, IssueCode, Location, Severity, DocumentReport, CrossCheckReport, RunReport,
} from './report/types.js'

export { namedNode } from './rdf/cross-checks.js'
export type { CrossCheck, CrossCheckDocument, CrossCheckFinding } from './rdf/cross-checks.js'

export { SKOLEM_PREFIX, isSkolemIri } from './document/skolemize.js'
