/*
 * Loading CSVW metadata: the description of how a CSV file maps to RDF.
 *
 * The metadata is read once, checked, and flattened - CSVW's inherited
 * properties (`aboutUrl`, `null`, `datatype`...) are resolved onto every
 * column - so the conversion in document/csvw.ts never has to look further
 * than the column in hand. Anything the conversion does not implement is
 * reported as a setup warning rather than silently ignored: a check that
 * quietly did not run is worse than one that says so.
 *
 * Alongside the table comes a context index synthesised from the columns, so
 * the report layer can name a property by the column that holds it, and a
 * concept by the label a CSV would use for it.
 */

import { ContextIndex, type RawContext } from '../document/context-index.js'
import { DSV, type CsvwColumn, type CsvwConcept, type CsvwDatatype, type CsvwTable, type NumericFormat } from '../document/csvw.js'
import { noteIssue, type Issue } from '../report/types.js'
import { SourceError } from './fetch.js'
import { readSource, type Environment, type Source } from './sources.js'

const CSVW_CONTEXT = 'http://www.w3.org/ns/csvw'
const SKOS = 'http://www.w3.org/2004/02/skos/core#'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'

/** The CSVW initial context's prefixes that URL templates commonly use. */
const PREFIXES: Record<string, string> = {
  rdf: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
  rdfs: 'http://www.w3.org/2000/01/rdf-schema#',
  xsd: 'http://www.w3.org/2001/XMLSchema#',
  owl: 'http://www.w3.org/2002/07/owl#',
  skos: SKOS,
  dc: 'http://purl.org/dc/terms/',
  dcterms: 'http://purl.org/dc/terms/',
  schema: 'http://schema.org/',
  foaf: 'http://xmlns.com/foaf/0.1/',
  csvw: 'http://www.w3.org/ns/csvw#',
  prov: 'http://www.w3.org/ns/prov#',
  dcat: 'http://www.w3.org/ns/dcat#',
}

const DATATYPES = new Set([
  'string', 'boolean', 'date', 'dateTime', 'datetime', 'time', 'decimal', 'double', 'float', 'anyURI',
  'integer', 'long', 'int', 'short', 'byte', 'nonNegativeInteger', 'positiveInteger',
  'nonPositiveInteger', 'negativeInteger', 'unsignedLong', 'unsignedInt', 'unsignedShort', 'unsignedByte',
])

const TABLE_KEYS = new Set(['@context', '@id', '@type', 'url', 'dialect', 'tableSchema', 'notes', 'tables'])
const INHERITED = ['aboutUrl', 'propertyUrl', 'valueUrl', 'datatype', 'null', 'separator', 'lang'] as const
const COLUMN_KEYS = new Set([
  '@id', '@type', 'name', 'titles', 'virtual', 'suppressOutput', 'required', ...INHERITED,
])
const DIALECT_DEFAULTS: Record<string, unknown> = {
  commentPrefix: undefined,
  doubleQuote: true,
  encoding: 'utf-8',
  quoteChar: '"',
  skipBlankRows: false,
  skipColumns: 0,
  skipInitialSpace: false,
}

export interface LoadedCsvw {
  /** Where the metadata came from, for the report's setup. */
  source: string
  table: CsvwTable
  /** The columns read as a JSON-LD context: column title -> property, label -> concept. */
  index: ContextIndex
  warnings: Issue[]
}

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)

/** A common property may be written as `dsv:x` or as its full IRI. */
function dsv (object: Json, name: string): unknown {
  return object[DSV + name] ?? object[`dsv:${name}`]
}

function skos (object: Json, name: string): unknown {
  return object[SKOS + name] ?? object[`skos:${name}`]
}

function strings (value: unknown): string[] {
  if (typeof value === 'string') return [value]
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string')
  // A natural-language property: { "en": [...], "fr": [...] }
  if (isObject(value)) return Object.values(value).flatMap(strings)
  return []
}

/** `rdf:type` -> its IRI; templates and absolute URLs are left alone. */
function expandPrefixed (template: string | undefined): string | undefined {
  if (template === undefined) return undefined
  const match = /^([A-Za-z][\w.-]*):(?!\/\/)(.*)$/.exec(template)
  if (!match) return template
  const namespace = PREFIXES[match[1]!]
  return namespace !== undefined ? namespace + match[2]! : template
}

class Reader {
  readonly warnings: Issue[] = []
  private readonly warned = new Set<string>()

  constructor (private readonly name: string) {}

  warn (key: string, title: string, hint?: string): void {
    if (this.warned.has(key)) return
    this.warned.add(key)
    this.warnings.push(noteIssue('csv-feature-unsupported', title, hint))
  }

  datatype (raw: unknown, where: string): CsvwDatatype {
    if (raw === undefined) return { base: 'string' }
    if (typeof raw === 'string') return this.datatype({ base: raw }, where)
    if (!isObject(raw)) throw new SourceError(`${this.name}: the datatype of ${where} is not a name or an object`, this.name)

    let base = typeof raw['base'] === 'string' ? raw['base'] : 'string'
    if (!DATATYPES.has(base)) {
      this.warn(`datatype:${base}`, `CSV datatype ${base} is not supported, so its cells are read as text`)
      base = 'string'
    }
    const facets = Object.keys(raw).filter((k) => !['base', 'format', '@id', '@type'].includes(k) && !k.includes(':'))
    if (facets.length > 0) {
      this.warn(
        `facets:${facets.join(',')}`,
        `CSV datatype constraints (${facets.join(', ')}) are not checked`,
        'Express them in the SHACL shapes instead, where they apply to JSON-LD records too.',
      )
    }

    const format = raw['format']
    if (format === undefined) return { base }
    if (typeof format === 'string') {
      if (['decimal', 'double', 'float'].includes(base) || base.endsWith('nteger') || base === 'long' || base === 'int') {
        this.warn(`pattern:${where}`, `the number pattern on ${where} is not supported, so it is not checked`)
        return { base }
      }
      return { base, format }
    }
    if (isObject(format)) {
      const numeric: NumericFormat = {}
      if (typeof format['groupChar'] === 'string') numeric.groupChar = format['groupChar']
      if (typeof format['decimalChar'] === 'string') numeric.decimalChar = format['decimalChar']
      if (format['pattern'] !== undefined) {
        this.warn(`pattern:${where}`, `the number pattern on ${where} is not supported, so it is not checked`)
      }
      return { base, format: numeric }
    }
    return { base }
  }

  valueMap (raw: unknown, where: string): CsvwConcept[] | undefined {
    if (raw === undefined) return undefined
    if (!Array.isArray(raw)) throw new SourceError(`${this.name}: dsv:valueMap on ${where} is not a list`, this.name)
    return raw.map((entry, i) => {
      if (!isObject(entry) || typeof entry['@id'] !== 'string') {
        throw new SourceError(`${this.name}: entry ${i + 1} of dsv:valueMap on ${where} has no @id`, this.name)
      }
      const iri = expandPrefixed(entry['@id'])!
      const label = strings(skos(entry, 'prefLabel'))[0] ?? iri.replace(/^.*[#/]/, '')
      return { iri, label, aliases: strings(skos(entry, 'altLabel')) }
    })
  }
}

function readTable (metadata: Json, reader: Reader, name: string): CsvwTable {
  const context = metadata['@context']
  const first = Array.isArray(context) ? context[0] : context
  if (first !== CSVW_CONTEXT) {
    throw new SourceError(`${name} is not CSVW metadata: its @context must be "${CSVW_CONTEXT}"`, name)
  }

  let table: Json = metadata
  if (Array.isArray(metadata['tables'])) {
    const tables = metadata['tables'].filter(isObject)
    if (tables.length === 0) throw new SourceError(`${name} describes no tables`, name)
    if (tables.length > 1) {
      reader.warn('tables', `${name} describes ${tables.length} tables; only the first is used for CSV files`)
    }
    // Inherited properties on the group still apply to the table.
    table = { ...Object.fromEntries(INHERITED.filter((k) => k in metadata).map((k) => [k, metadata[k]])), ...tables[0]! }
  }

  const schema = table['tableSchema']
  if (!isObject(schema)) {
    throw new SourceError(
      typeof schema === 'string'
        ? `${name}: a tableSchema referenced by URL is not supported - include it in the metadata`
        : `${name} has no tableSchema`,
      name,
    )
  }
  for (const key of Object.keys(table)) {
    if (!TABLE_KEYS.has(key) && !INHERITED.includes(key as typeof INHERITED[number]) && !key.includes(':')) {
      reader.warn(`table:${key}`, `CSVW property ${key} is not supported and was ignored`)
    }
  }
  for (const key of ['primaryKey', 'foreignKeys', 'rowTitles']) {
    if (key in schema) reader.warn(`schema:${key}`, `CSVW ${key} is not checked`)
  }

  const dialect = isObject(table['dialect']) ? table['dialect'] : {}
  for (const [key, fallback] of Object.entries(DIALECT_DEFAULTS)) {
    if (key in dialect && dialect[key] !== fallback) {
      reader.warn(`dialect:${key}`, `CSV dialect setting ${key} is not supported and was ignored`)
    }
  }
  const header = dialect['header'] !== false
  const headerRowCount = typeof dialect['headerRowCount'] === 'number' ? dialect['headerRowCount'] : header ? 1 : 0
  if (headerRowCount > 1) {
    reader.warn('dialect:headerRowCount', 'only the first header row is used to match columns')
  }
  const rawTrim = dialect['trim'] ?? true
  const trim = rawTrim === true ? 'true' : rawTrim === false ? 'false' : rawTrim === 'start' || rawTrim === 'end' ? rawTrim : 'true'

  const headerMatch = dsv(table, 'headerMatch') ?? dsv(metadata, 'headerMatch')
  if (headerMatch !== undefined && headerMatch !== 'first-line') {
    throw new SourceError(`${name}: dsv:headerMatch must be "first-line"`, name)
  }

  const inherited: Json = {}
  for (const level of [metadata, table, schema]) {
    for (const key of INHERITED) if (key in level) inherited[key] = level[key]
  }

  const rawColumns = Array.isArray(schema['columns']) ? schema['columns'].filter(isObject) : []
  if (rawColumns.length === 0) throw new SourceError(`${name} has no columns`, name)

  const columns: CsvwColumn[] = []
  let seenVirtual = false
  rawColumns.forEach((raw, i) => {
    const merged: Json = { ...inherited, ...raw }
    const titles = strings(raw['titles'])
    const columnName = typeof raw['name'] === 'string'
      ? raw['name']
      : titles[0] !== undefined ? encodeURIComponent(titles[0]) : `_col.${i + 1}`
    const where = `column ${titles[0] ?? columnName}`
    for (const key of Object.keys(raw)) {
      if (!COLUMN_KEYS.has(key) && !key.includes(':')) {
        reader.warn(`column:${key}`, `CSVW column property ${key} is not supported and was ignored`)
      }
    }
    if ('required' in raw) {
      reader.warn('column:required', 'CSVW required is not checked here', 'Use sh:minCount in the shapes instead.')
    }
    if (raw['suppressOutput'] === true) return
    const virtual = raw['virtual'] === true
    if (!virtual && seenVirtual) {
      throw new SourceError(`${name}: ${where} follows a virtual column; virtual columns must come last`, name)
    }
    seenVirtual ||= virtual

    const nulls = merged['null'] === undefined ? [''] : strings(merged['null'])
    const separator = typeof merged['separator'] === 'string' ? merged['separator'] : undefined
    const valueMap = reader.valueMap(dsv(raw, 'valueMap'), where)
    const column: CsvwColumn = {
      name: columnName,
      titles,
      virtual,
      datatype: reader.datatype(merged['datatype'], where),
      null: nulls,
      skipIfNodeEmpty: dsv(raw, 'skipIfNodeEmpty') === true,
    }
    const aboutUrl = expandPrefixed(merged['aboutUrl'] as string | undefined)
    const propertyUrl = expandPrefixed(merged['propertyUrl'] as string | undefined)
    const valueUrl = expandPrefixed(merged['valueUrl'] as string | undefined)
    if (aboutUrl !== undefined) column.aboutUrl = aboutUrl
    if (propertyUrl !== undefined) column.propertyUrl = propertyUrl
    if (valueUrl !== undefined) column.valueUrl = valueUrl
    if (separator !== undefined) column.separator = separator
    if (valueMap !== undefined) column.valueMap = valueMap
    if (virtual && valueUrl === undefined) {
      throw new SourceError(`${name}: virtual ${where} has no valueUrl`, name)
    }
    columns.push(column)
  })

  const delimiter = typeof dialect['delimiter'] === 'string' ? dialect['delimiter'] : ','
  return {
    delimiter,
    header,
    headerRowCount,
    skipRows: typeof dialect['skipRows'] === 'number' ? dialect['skipRows'] : 0,
    trim,
    ...(headerMatch === 'first-line' ? { headerMatch } : {}),
    columns,
  }
}

/**
 * The columns as a JSON-LD context, for the report layer: each column's title
 * is the term for its property, and each concept's label the token for it.
 * Classes typed by virtual columns are terms too, so a node can be named.
 */
function namingContext (table: CsvwTable): RawContext {
  const context: Json = {}
  for (const column of table.columns) {
    if (column.virtual) {
      if (column.propertyUrl === RDF_TYPE && column.valueUrl !== undefined && !column.valueUrl.includes('{')) {
        context[column.valueUrl.replace(/^.*[#/]/, '')] = column.valueUrl
      }
      continue
    }
    const property = column.propertyUrl
    const title = column.titles[0] ?? column.name
    if (property === undefined || property.includes('{') || title in context) continue
    if (column.valueMap !== undefined) {
      context[title] = {
        '@id': property,
        '@type': '@vocab',
        '@context': Object.fromEntries(column.valueMap.map((c) => [c.label, c.iri])),
      }
    } else {
      context[title] = property
    }
  }
  return context
}

export async function loadCsvw (source: Source, env: Environment): Promise<LoadedCsvw> {
  const read = await readSource(source, env, 'CSVW metadata')
  let metadata: unknown = read.json
  if (metadata === undefined) {
    try {
      metadata = JSON.parse(read.text ?? '')
    } catch (error) {
      throw new SourceError(`${read.name} is not valid JSON: ${(error as Error).message}`, read.name)
    }
  }
  if (!isObject(metadata)) throw new SourceError(`${read.name} is not CSVW metadata`, read.name)

  const reader = new Reader(read.name)
  const table = readTable(metadata, reader, read.name)
  return { source: read.name, table, index: new ContextIndex(namingContext(table)), warnings: reader.warnings }
}
