/*
 * CSV to RDF, as described by W3C CSV on the Web (CSVW) metadata.
 *
 * This is csv2rdf in minimal mode for the part of CSVW a data standard needs:
 * each row becomes one or more nodes named by `aboutUrl` templates, each
 * column a property (`propertyUrl`) whose cells are parsed by `datatype`, or
 * turned into IRIs by `valueUrl`; virtual columns add the links and types
 * that a flat row cannot hold. The JSON-LD path never sees any of this - the
 * RDF goes straight to the SHACL engine, and the index built alongside it is
 * what lets a result about `#row-3/requirements` be reported as row 3, column
 * `pets`, line 12.
 *
 * Two deliberate departures from the specification, both in the user's
 * favour, are documented in docs/csv.md:
 *
 *   - columns are matched to the header by title, not by position, so a
 *     reordered file still validates (and a missing column is reported by
 *     name);
 *   - `dsv:headerMatch: first-line` compares only the first line of a header
 *     cell, for exports that put help text under the column name.
 *
 * And two extensions, CSVW common properties in the dsv: namespace:
 *
 *   - `dsv:valueMap` maps the labels a column may hold to concept IRIs,
 *     ignoring case and spaces - what a controlled vocabulary needs and a
 *     `valueUrl` template cannot express;
 *   - `dsv:skipIfNodeEmpty` drops a virtual column when the row gave the
 *     node it describes no values, so an optional part of a record that was
 *     left empty is absent rather than present and incomplete.
 *
 * Nothing here is about any particular standard.
 */

import { parseCsv, isBlank, type CsvCell, type CsvRecord } from './csv.js'
import { rdf } from '../rdf/parse.js'
import type { Dataset } from 'rdf-ext'
import type { BlankNode, NamedNode, Literal } from '@rdfjs/types'

export const DSV = 'https://theodi.github.io/data-standard-validator/ns#'
const XSD = 'http://www.w3.org/2001/XMLSchema#'
const RDF_TYPE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type'
/** What a column without an `aboutUrl` describes, when rows are skolemized. */
const ROW_TEMPLATE = '#row-{_row}'

// ---------------------------------------------------------------------------
// The metadata, once loaded and normalised (see load/csvw.ts)
// ---------------------------------------------------------------------------

export interface NumericFormat {
  groupChar?: string
  decimalChar?: string
}

export interface CsvwDatatype {
  /** A CSVW built-in datatype name: `boolean`, `date`, `nonNegativeInteger`... */
  base: string
  /** `Yes|No` for booleans, `dd/MM/yyyy` for dates, separators for numbers. */
  format?: string | NumericFormat
}

export interface CsvwConcept {
  iri: string
  /** What to call the value back to the user. */
  label: string
  /** Every other spelling accepted for it. */
  aliases: string[]
}

export interface CsvwColumn {
  name: string
  titles: string[]
  virtual: boolean
  aboutUrl?: string
  propertyUrl?: string
  valueUrl?: string
  datatype: CsvwDatatype
  null: string[]
  separator?: string
  valueMap?: CsvwConcept[]
  skipIfNodeEmpty: boolean
}

export interface CsvwTable {
  delimiter: string
  header: boolean
  headerRowCount: number
  skipRows: number
  trim: 'true' | 'false' | 'start' | 'end'
  headerMatch?: 'first-line'
  columns: CsvwColumn[]
}

// ---------------------------------------------------------------------------
// What the conversion produces
// ---------------------------------------------------------------------------

/** One cell, as a report would point at it. */
export interface CellLocation {
  /** Data row, 1-based, header excluded: CSVW's `_row`. */
  row: number
  /** Record number in the file, header included: RFC 7111's `row=`. */
  sourceRow: number
  /** Column number in the file, 1-based: RFC 7111's `col=`. */
  sourceColumn: number
  /** The column's title as the metadata gives it. */
  title: string
  /** The text in the cell, before any parsing. */
  text: string
  line: number
  column: number
  endLine: number
  endColumn: number
}

/** One row's place in the file. */
export interface RowLocation {
  row: number
  sourceRow: number
  line: number
  column: number
  endLine: number
  endColumn: number
}

export type CsvwProblem =
  | { kind: 'missing-column', title: string }
  | { kind: 'unexpected-column', title: string, cell: CsvCell, sourceColumn: number }
  | { kind: 'bad-value', cell: CellLocation, expected: CsvwDatatype, value: string }
  | { kind: 'bad-template', column: string, template: string, row: number, message: string }

export interface CsvwNode {
  row: RowLocation
  /** The class IRI a virtual column gave the node, if any. */
  type?: string
}

export interface CsvwResult {
  dataset: Dataset
  /** Node IRI -> the row it came from. */
  nodes: Map<string, CsvwNode>
  /** `subject IRI + ' ' + property IRI` -> the cell that holds it. */
  cells: Map<string, CellLocation>
  problems: CsvwProblem[]
  /** The number of data rows converted. */
  rows: number
}

export const cellKey = (subject: string, property: string): string => `${subject} ${property}`

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** How labels are compared: case and spacing ignored, so `<5 days` is `< 5 days`. */
export function looseLabel (label: string): string {
  return label.replace(/\s+/g, '').toLowerCase()
}

function applyTrim (value: string, trim: CsvwTable['trim']): string {
  if (trim === 'true') return value.trim()
  if (trim === 'start') return value.trimStart()
  if (trim === 'end') return value.trimEnd()
  return value
}

const INTEGER_RANGES: Record<string, [bigint | null, bigint | null]> = {
  integer: [null, null],
  long: [-(2n ** 63n), 2n ** 63n - 1n],
  int: [-(2n ** 31n), 2n ** 31n - 1n],
  short: [-32768n, 32767n],
  byte: [-128n, 127n],
  nonNegativeInteger: [0n, null],
  positiveInteger: [1n, null],
  nonPositiveInteger: [null, 0n],
  negativeInteger: [null, -1n],
  unsignedLong: [0n, 2n ** 64n - 1n],
  unsignedInt: [0n, 2n ** 32n - 1n],
  unsignedShort: [0n, 65535n],
  unsignedByte: [0n, 255n],
}

/** CSVW date formats are built from these fields and literal separators. */
const DATE_FIELD = /yyyy|MM|M|dd|d/g

function parseDate (value: string, format: string | undefined): string | undefined {
  if (format === undefined) {
    return /^-?\d{4,}-\d{2}-\d{2}(Z|[+-]\d{2}:\d{2})?$/.test(value) && validDate(value.slice(0, 10)) ? value : undefined
  }
  const fields: string[] = []
  const source = format.replace(/[.*+?^${}()|[\]\\/]/g, (c) => (c === '/' ? '\\/' : `\\${c}`))
    .replace(DATE_FIELD, (field) => {
      fields.push(field)
      return field === 'yyyy' ? '(\\d{4})' : field.length === 2 ? '(\\d{2})' : '(\\d{1,2})'
    })
  const match = new RegExp(`^${source}$`).exec(value)
  if (!match) return undefined
  let year = ''
  let month = ''
  let day = ''
  fields.forEach((field, index) => {
    const part = match[index + 1]!
    if (field === 'yyyy') year = part
    else if (field.startsWith('M')) month = part.padStart(2, '0')
    else day = part.padStart(2, '0')
  })
  const iso = `${year}-${month}-${day}`
  return validDate(iso) ? iso : undefined
}

function validDate (iso: string): boolean {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number]
  if (!(m >= 1 && m <= 12 && d >= 1)) return false
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d <= days
}

type Parsed = { ok: true, term: NamedNode | Literal } | { ok: false }

function typed (lexical: string, base: string): Literal {
  return rdf.literal(lexical, rdf.namedNode(XSD + base))
}

/** A cell's text parsed by the column's datatype, as an RDF literal. */
export function parseValue (value: string, datatype: CsvwDatatype): Parsed {
  const { base, format } = datatype
  const numeric: NumericFormat = typeof format === 'object' ? format : {}

  if (base === 'string') return { ok: true, term: rdf.literal(value) }

  if (base === 'boolean') {
    if (typeof format === 'string' && format.includes('|')) {
      const [yes, no] = format.split('|') as [string, string]
      if (value === yes) return { ok: true, term: typed('true', base) }
      if (value === no) return { ok: true, term: typed('false', base) }
      return { ok: false }
    }
    if (value === 'true' || value === '1') return { ok: true, term: typed('true', base) }
    if (value === 'false' || value === '0') return { ok: true, term: typed('false', base) }
    return { ok: false }
  }

  if (base in INTEGER_RANGES) {
    const plain = numeric.groupChar !== undefined ? value.split(numeric.groupChar).join('') : value
    if (!/^[+-]?\d+$/.test(plain)) return { ok: false }
    const n = BigInt(plain)
    const [min, max] = INTEGER_RANGES[base]!
    if ((min !== null && n < min) || (max !== null && n > max)) return { ok: false }
    return { ok: true, term: typed(n.toString(), base) }
  }

  if (base === 'decimal' || base === 'double' || base === 'float') {
    let plain = numeric.groupChar !== undefined ? value.split(numeric.groupChar).join('') : value
    if (numeric.decimalChar !== undefined && numeric.decimalChar !== '.') {
      if (plain.includes('.')) return { ok: false }
      plain = plain.split(numeric.decimalChar).join('.')
    }
    const pattern = base === 'decimal'
      ? /^[+-]?(\d+(\.\d*)?|\.\d+)$/
      : /^([+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?|INF|-INF|NaN)$/
    if (!pattern.test(plain)) return { ok: false }
    return { ok: true, term: typed(plain, base) }
  }

  if (base === 'date') {
    const iso = parseDate(value, typeof format === 'string' ? format : undefined)
    return iso !== undefined ? { ok: true, term: typed(iso, base) } : { ok: false }
  }

  if (base === 'dateTime' || base === 'datetime') {
    const ok = /^-?\d{4,}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(value)
    return ok ? { ok: true, term: typed(value, 'dateTime') } : { ok: false }
  }

  if (base === 'time') {
    const ok = /^\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.test(value)
    return ok ? { ok: true, term: typed(value, base) } : { ok: false }
  }

  if (base === 'anyURI') return { ok: true, term: typed(value, base) }

  // load/csvw.ts warns about anything else and reads it as a string.
  return { ok: true, term: rdf.literal(value) }
}

// ---------------------------------------------------------------------------
// URI templates (RFC 6570, the operators CSVW uses)
// ---------------------------------------------------------------------------

const UNRESERVED = /[A-Za-z0-9\-._~]/
const RESERVED = /[:/?#[\]@!$&'()*+,;=]/

function encode (value: string, allowReserved: boolean): string {
  let out = ''
  for (const char of value) {
    if (UNRESERVED.test(char) || (allowReserved && RESERVED.test(char))) out += char
    else out += encodeURIComponent(char)
  }
  return out
}

export function expandTemplate (template: string, vars: Record<string, string | undefined>): string {
  return template.replace(/\{([+#]?)([A-Za-z0-9_.%]+)\}/g, (_, op: string, name: string) => {
    const value = vars[decodeURIComponent(name)]
    if (value === undefined) return ''
    const encoded = encode(value, op !== '')
    return op === '#' ? `#${encoded}` : encoded
  })
}

// ---------------------------------------------------------------------------
// The conversion
// ---------------------------------------------------------------------------

interface Header {
  /** Metadata column index -> file column index (0-based), for real columns. */
  positions: Map<number, number>
}

function cleanTitle (raw: string, table: CsvwTable): string {
  const first = table.headerMatch === 'first-line' ? raw.split(/\r?\n/)[0] ?? '' : raw
  return first.trim()
}

function matchHeader (header: CsvRecord | undefined, table: CsvwTable, problems: CsvwProblem[]): Header {
  const positions = new Map<number, number>()
  const real = table.columns.map((c, i) => [c, i] as const).filter(([c]) => !c.virtual)

  if (header === undefined) {
    // No header row: CSVW's own rule, columns by position.
    real.forEach(([, index], position) => positions.set(index, position))
    return { positions }
  }

  const titles = header.cells.map((cell) => cleanTitle(cell.value, table))
  const claimed = new Set<number>()
  const find = (wanted: string[], compare: (a: string, b: string) => boolean): number =>
    titles.findIndex((title, position) => !claimed.has(position) && wanted.some((w) => compare(w, title)))

  for (const [column, index] of real) {
    let position = find(column.titles, (a, b) => a === b)
    if (position === -1) position = find(column.titles, (a, b) => a.toLowerCase() === b.toLowerCase())
    if (position === -1) {
      problems.push({ kind: 'missing-column', title: column.titles[0] ?? column.name })
      continue
    }
    claimed.add(position)
    positions.set(index, position)
  }

  titles.forEach((title, position) => {
    if (claimed.has(position) || title === '') return
    problems.push({ kind: 'unexpected-column', title, cell: header.cells[position]!, sourceColumn: position + 1 })
  })
  return { positions }
}

function rowSpan (record: CsvRecord, row: number): RowLocation {
  const first = record.cells[0]!
  const last = record.cells[record.cells.length - 1]!
  return {
    row,
    sourceRow: record.number,
    line: first.line,
    column: first.column,
    endLine: last.endLine,
    endColumn: last.endColumn,
  }
}

export interface CsvToRdfOptions {
  /**
   * Name each row's node `#row-{_row}` when the metadata gives it no
   * `aboutUrl`, the CSV counterpart of skolemizing a JSON document. Off, the
   * row is a blank node, as CSVW itself specifies; either way the indexes
   * below are keyed by the node's value, so locations are unaffected.
   */
  skolemize?: boolean
}

/**
 * Convert CSV text to RDF. `base` is the table's URL, against which the
 * relative templates (`#row-{_row}`) resolve.
 *
 * Throws `CsvSyntaxError` when the text is not CSV at all.
 */
export function csvToRdf (text: string, table: CsvwTable, base: string, options: CsvToRdfOptions = {}): CsvwResult {
  const skolemize = options.skolemize !== false
  const records = parseCsv(text, { delimiter: table.delimiter }).slice(table.skipRows)
  const problems: CsvwProblem[] = []
  const headerRecords = table.header ? records.slice(0, Math.max(1, table.headerRowCount)) : []
  const body = records.slice(headerRecords.length)
  const { positions } = matchHeader(headerRecords[0], table, problems)

  const dataset = rdf.dataset()
  const nodes = new Map<string, CsvwNode>()
  const cells = new Map<string, CellLocation>()

  const resolve = (template: string, vars: Record<string, string | undefined>): string =>
    new URL(expandTemplate(template, vars), base).href

  let row = 0
  for (const record of body) {
    if (isBlank(record)) continue
    row++
    const span = rowSpan(record, row)
    const vars: Record<string, string | undefined> = { _row: String(row), _sourceRow: String(record.number) }
    table.columns.forEach((column, index) => {
      const position = positions.get(index)
      if (position !== undefined) vars[column.name] = applyTrim(record.cells[position]?.value ?? '', table.trim)
    })

    /** Nodes (and their ancestors' prefixes) that received a value from a real column. */
    const filled: string[] = []
    const node = (iri: string): void => {
      if (!nodes.has(iri)) nodes.set(iri, { row: span })
    }
    let rowNode: BlankNode | undefined
    const urlFor = (column: CsvwColumn, template: string | undefined, fallback: string): string | undefined => {
      try {
        return resolve(template ?? fallback, { ...vars, _name: column.name })
      } catch (error) {
        problems.push({
          kind: 'bad-template', column: column.name, template: template ?? fallback, row, message: (error as Error).message,
        })
        return undefined
      }
    }

    const subjectFor = (column: CsvwColumn): NamedNode | BlankNode | undefined => {
      if (column.aboutUrl === undefined && !skolemize) return (rowNode ??= rdf.blankNode())
      const iri = urlFor(column, column.aboutUrl, ROW_TEMPLATE)
      return iri === undefined ? undefined : rdf.namedNode(iri)
    }

    table.columns.forEach((column, index) => {
      if (column.virtual) return
      const position = positions.get(index)
      if (position === undefined) return
      const subjectTerm = subjectFor(column)
      const predicate = urlFor(column, column.propertyUrl, '{#_name}')
      if (subjectTerm === undefined || predicate === undefined) return
      const subject = subjectTerm.value
      node(subject)

      const raw = record.cells[position]
      const text = applyTrim(raw?.value ?? '', table.trim)
      const where: CellLocation = {
        row,
        sourceRow: record.number,
        sourceColumn: position + 1,
        title: column.titles[0] ?? column.name,
        text,
        ...(raw !== undefined
          ? { line: raw.line, column: raw.column, endLine: raw.endLine, endColumn: raw.endColumn }
          : { line: span.endLine, column: span.endColumn, endLine: span.endLine, endColumn: span.endColumn }),
      }
      // Recorded even for an empty cell: "missing required field" belongs there too.
      cells.set(cellKey(subject, predicate), where)

      if (column.null.includes(text)) return
      const items = column.separator !== undefined
        ? text.split(column.separator).map((item) => applyTrim(item, table.trim))
        : [text]

      for (const item of items) {
        if (column.null.includes(item)) continue
        let object: NamedNode | Literal | undefined
        if (column.valueMap !== undefined) {
          const wanted = looseLabel(item)
          const concept = column.valueMap.find((c) =>
            looseLabel(c.label) === wanted || c.aliases.some((a) => looseLabel(a) === wanted))
          // An unknown label goes through as written, so the shape's own
          // sh:in reports it, with the permitted values.
          object = concept !== undefined ? rdf.namedNode(concept.iri) : rdf.literal(item)
        } else if (column.valueUrl !== undefined) {
          const iri = urlFor(column, column.valueUrl, '')
          if (iri === undefined) continue
          object = rdf.namedNode(iri)
        } else {
          const parsed = parseValue(item, column.datatype)
          if (parsed.ok) {
            object = parsed.term
          } else {
            problems.push({ kind: 'bad-value', cell: where, expected: column.datatype, value: item })
            // Kept as text, so the shape still sees a value: a cell that is
            // wrong is not the same as a cell that is empty.
            object = rdf.literal(item)
          }
        }
        dataset.add(rdf.quad(subjectTerm, rdf.namedNode(predicate), object))
        filled.push(subject)
      }
    })

    for (const column of table.columns) {
      if (!column.virtual) continue
      const subjectTerm = subjectFor(column)
      const predicate = urlFor(column, column.propertyUrl, '{#_name}')
      const object = column.valueUrl !== undefined ? urlFor(column, column.valueUrl, '') : undefined
      if (subjectTerm === undefined || predicate === undefined || object === undefined) continue
      const subject = subjectTerm.value
      if (column.skipIfNodeEmpty) {
        const described = predicate === RDF_TYPE ? subject : object
        const empty = !filled.some((iri) => iri === described || iri.startsWith(`${described}/`))
        if (empty) continue
      }
      node(subject)
      dataset.add(rdf.quad(subjectTerm, rdf.namedNode(predicate), rdf.namedNode(object)))
      if (predicate === RDF_TYPE) {
        const entry = nodes.get(subject)!
        entry.type ??= object
      }
    }
  }

  return { dataset, nodes, cells, problems, rows: row }
}
