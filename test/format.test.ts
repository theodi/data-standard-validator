import { beforeAll, describe, expect, test } from 'vitest'
import { validate, formatReport, type RunReport } from '../src/node.js'
import { fixture, fixtureText } from './helpers.js'

let report: RunReport
const sources = new Map<string, string>()

beforeAll(async () => {
  const data = ['valid.jsonld', 'invalid.jsonld'].map(fixture)
  for (const file of data) sources.set(file, fixtureText(file.split('/').pop()!))
  report = await validate({ shapes: fixture('person-shape.ttl'), data })
})

describe('text', () => {
  test('gives a verdict per document, the problems, a code frame and a summary', () => {
    const out = formatReport(report, 'text', { color: false, sources })
    expect(out).toContain('person-shape.ttl · 2 document(s)')
    expect(out).toMatch(/valid\.jsonld -> passes/)
    expect(out).toMatch(/invalid\.jsonld -> fails/)
    expect(out).toContain('x status must be one of the permitted values')
    expect(out).toContain('at address[0].postcode  line 6')
    expect(out).toMatch(/\s+6 \| .*"postcode": "nope"/)
    expect(out).toContain('4 problems')
    expect(out).not.toContain('\u001b[')
  })

  test('honours a custom title', () => {
    expect(formatReport(report, 'text', { color: false, title: 'People' })).toContain('People · 2 document(s)')
  })
})

describe('json', () => {
  test('is the report, verbatim', () => {
    expect(JSON.parse(formatReport(report, 'json'))).toEqual(report)
  })
})

describe('markdown', () => {
  const md = (): string => formatReport(report, 'markdown')

  test('opens with a heading, a verdict and a table of documents', () => {
    expect(md()).toMatch(/^# person-shape\.ttl\n\n❌ \*\*Failed\*\* - 4 problems\n/)
    expect(md()).toContain('| Document | Result | Problems | Warnings |')
    expect(md()).toMatch(/\| .*invalid\.jsonld \| ❌ fails \| 4 \| 0 \|/)
  })

  test('lists each problem under its object, with where and how to fix it', () => {
    expect(md()).toContain('### Address (address\\[0\\])')
    expect(md()).toContain('- ❌ `postcode` is not in the expected format - you gave `nope`')
    expect(md()).toContain('  - at `address[0].postcode`, line 6')
    expect(md()).toContain('  - Allowed values: Active, Inactive.')
  })

  test('a passing run says so', async () => {
    const ok = await validate({ shapes: fixture('person-shape.ttl'), data: fixture('valid.jsonld') })
    expect(formatReport(ok, 'markdown')).toContain('✅ **Passed** - 1 document conform')
  })
})

test('an unknown format is an error', () => {
  expect(() => formatReport(report, 'yaml' as never)).toThrow(/unknown format/)
})
