/*
 * CSV documents, read through CSVW metadata, end to end.
 */

import { describe, expect, test } from 'vitest'
import { createValidator, formatReport, validate } from '../src/node.js'
import type { DocumentReport, Issue, ValidatorOptions } from '../src/node.js'
import { SKOLEM_BASE } from '../src/document/skolemize.js'
import { fixture, fixtureText } from './helpers.js'

const options: ValidatorOptions = {
  shapes: [fixture('person-shape.ttl'), fixture('csv/membership-shape.ttl')],
  csvMetadata: fixture('csv/people-csv-metadata.json'),
}

const where = (report: DocumentReport): string[] =>
  report.issues.map((i) => `${i.code} @ ${i.location.jsonPath}`).sort()

const at = (report: DocumentReport, column: string): Issue[] =>
  report.issues.filter((i) => i.location.cell?.column === column)

describe('CSV through CSVW metadata', () => {
  test('a valid file conforms: multi-line headers, loose labels, nulls, lists and empty optional nodes', async () => {
    const report = await validate({ ...options, data: fixture('csv/people.csv') })
    expect(report.documents[0]!.issues).toEqual([])
    expect(report.conforms).toBe(true)
    expect(report.setup.csvMetadata).toBe(fixture('csv/people-csv-metadata.json'))
  })

  test('each problem is reported at its row and column', async () => {
    const report = await validate({ ...options, data: fixture('csv/people-invalid.csv') })
    expect(report.conforms).toBe(false)
    expect(where(report.documents[0]!)).toEqual([
      'bad-format @ row 1, joined',
      'bad-format @ row 1, member',
      'bad-format @ row 1, postcode',
      'csv-column-unexpected @ header, notes',
      'out-of-range @ row 1, age',
      'required-field-missing @ row 1, full_name',
      'value-not-allowed @ row 1, roles',
      'value-not-allowed @ row 1, status',
    ])
  })

  test('issues carry the cell, its line and column, the column name and the labels a CSV uses', async () => {
    const doc = (await validate({ ...options, data: fixture('csv/people-invalid.csv') })).documents[0]!
    const [status] = at(doc, 'status')
    expect(status!.location).toMatchObject({
      cell: { row: 1, column: 'status' }, line: 2, column: 5, endColumn: 12, pointer: '#cell=2,3',
    })
    expect(status!.field).toEqual({ term: 'status', iri: 'https://example.org/status' })
    expect(status!.value).toBe('Retired')
    expect(status!.allowedValues).toEqual(['Active', 'Inactive'])
    expect(at(doc, 'roles')[0]!.allowedValues).toEqual(['Admin', 'Editor'])
  })

  test('a value its datatype cannot read is one issue, worded for the format, not also a type error', async () => {
    const doc = (await validate({ ...options, data: fixture('csv/people-invalid.csv') })).documents[0]!
    const member = at(doc, 'member')
    expect(member).toHaveLength(1)
    expect(member[0]!.title).toBe('`member` is not in the expected format - you gave `Maybe`')
    expect(member[0]!.hint).toBe('It should be `Yes` or `No`.')
    expect(at(doc, 'joined')[0]!.hint).toBe('It should be a date written dd/MM/yyyy, for example `21/03/2024`.')
  })

  test('a required value in an empty cell is reported at that cell', async () => {
    const doc = (await validate({ ...options, data: fixture('csv/people-invalid.csv') })).documents[0]!
    const [name] = at(doc, 'full_name')
    expect(name!.code).toBe('required-field-missing')
    expect(name!.location).toMatchObject({ line: 2, column: 1 })
  })

  test('a missing column is reported by name', async () => {
    const text = fixtureText('csv/people.csv').replace(',roles\n', '\n').replace(/,Admin; editor\n/, '\n').replace(/,\n$/, '\n')
    const doc = (await validate({ ...options, data: { text, name: 'people.csv' } })).documents[0]!
    expect(where(doc)).toEqual(['csv-column-missing @ header'])
    expect(doc.issues[0]!.title).toBe('The column `roles` is missing')
    expect(doc.conforms).toBe(false)
  })

  test('columns are matched by title, so a reordered file still validates', async () => {
    const text = 'age,full_name,status,postcode,member,joined,roles\n36,Ada Lovelace,Active,AB1,Yes,10/12/1815,\n'
    expect((await validate({ ...options, data: { text, format: 'csv' } })).conforms).toBe(true)
  })

  test('the format comes from the name, or is given', async () => {
    const text = fixtureText('csv/people.csv')
    expect((await validate({ ...options, data: { text, name: 'upload.CSV' } })).conforms).toBe(true)
    expect((await validate({ ...options, data: { text, format: 'csv' } })).conforms).toBe(true)
    const asJson = await validate({ ...options, data: { text, name: 'upload.txt' } })
    expect(asJson.documents[0]!.issues[0]!.code).toBe('parse-error')
  })

  test('a CSV file without metadata fails rather than passing unchecked', async () => {
    const report = await validate({ shapes: options.shapes, data: fixture('csv/people.csv') })
    expect(report.conforms).toBe(false)
    expect(report.documents[0]!.issues.map((i) => i.code)).toEqual(['no-csv-metadata'])
  })

  test('malformed CSV is a parse error with a line', async () => {
    const doc = (await validate({ ...options, data: { text: 'full_name,age\n"Ada,36\n', format: 'csv' } })).documents[0]!
    expect(doc.issues).toHaveLength(1)
    expect(doc.issues[0]).toMatchObject({ code: 'parse-error', location: { line: 2, column: 1 } })
  })

  test('a file with a header but no rows fails', async () => {
    const doc = (await validate({ ...options, data: { text: 'full_name,age\n', format: 'csv' } })).documents[0]!
    expect(doc.conforms).toBe(false)
  })

  test('metadata the validator cannot fully honour says so', async () => {
    const metadata = JSON.parse(fixtureText('csv/people-csv-metadata.json'))
    metadata.tableSchema.columns[0].required = true
    metadata.tableSchema.columns[1].datatype = { base: 'integer', minimum: 0 }
    const validator = await createValidator({ ...options, csvMetadata: { json: metadata, name: 'meta.json' } })
    expect(validator.setup.warnings.map((w) => w.code)).toEqual(['csv-feature-unsupported', 'csv-feature-unsupported'])
  })

  test('rows without an aboutUrl are located alike, skolemized or left blank as CSVW has them', async () => {
    const metadata = JSON.parse(fixtureText('csv/people-csv-metadata.json'))
    delete metadata.tableSchema.aboutUrl
    const csvMetadata = { json: metadata, name: 'meta.json' }
    const data = fixture('csv/people-invalid.csv')
    const on = (await validate({ ...options, csvMetadata, data })).documents[0]!
    const off = (await validate({ ...options, csvMetadata, data, skolemize: false })).documents[0]!
    expect(where(off)).toEqual(where(on))
    expect(off.issues.map((i) => i.location.line)).toEqual(on.issues.map((i) => i.location.line))
    const rowIssue = off.issues.find((i) => i.technical?.focusNode.startsWith('(anonymous node at row'))
    expect(rowIssue, 'a blank row is described by where it is').toBeDefined()
  })

  test('metadata that is not CSVW is refused', async () => {
    await expect(createValidator({ ...options, csvMetadata: { json: { tableSchema: {} }, name: 'x.json' } }))
      .rejects.toThrow(/not CSVW metadata/)
  })

  test('no IRI, real or made up, reaches a title, a hint or a formatted report', async () => {
    const report = await validate({ ...options, data: { text: fixtureText('csv/people-invalid.csv'), name: 'people.csv' } })
    for (const issue of report.documents[0]!.issues) {
      expect(`${issue.title} ${issue.hint ?? ''}`).not.toMatch(/https?:\/\//)
      expect(issue.technical?.focusNode ?? '').not.toContain(SKOLEM_BASE)
    }
    for (const format of ['text', 'markdown'] as const) {
      expect(formatReport(report, format, { color: false })).not.toContain(SKOLEM_BASE)
    }
  })

  test('the text report groups by row and quotes the offending cell', async () => {
    const text = fixtureText('csv/people-invalid.csv')
    const report = await validate({ ...options, data: { text, name: 'people.csv' } })
    const out = formatReport(report, 'text', { color: false, sources: new Map([['people.csv', text]]) })
    expect(out).toContain('in row 1')
    expect(out).toContain('in the header row')
    expect(out).toContain('at row 1, status  line 2')
  })
})
