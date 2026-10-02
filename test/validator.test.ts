/*
 * The pipeline end to end, against small offline fixtures.
 */

import { describe, expect, test } from 'vitest'
import { createValidator, validate, namedNode, SKOLEM_PREFIX, formatReport, NotFoundError } from '../src/node.js'
import type { CrossCheck, DocumentReport } from '../src/node.js'
import { fixture, fixtureFetch, fixtureText } from './helpers.js'

const shapes = fixture('person-shape.ttl')

const codesAndPaths = (report: DocumentReport): [string, string][] =>
  report.issues.map((i) => [i.code, i.location.jsonPath])

describe('validate', () => {
  test('a valid document conforms, resolving its relative @context from disk', async () => {
    const report = await validate({ shapes, data: fixture('valid.jsonld') })
    expect(report.conforms).toBe(true)
    expect(report.documents[0]!.issues).toEqual([])
    expect(report.setup.shapes).toEqual([shapes])
  })

  test('an invalid document reports each problem at its JSON path', async () => {
    const report = await validate({ shapes, data: fixture('invalid.jsonld') })
    expect(report.conforms).toBe(false)
    expect(codesAndPaths(report.documents[0]!)).toEqual([
      ['required-field-missing', 'name'],
      ['out-of-range', 'age'],
      ['value-not-allowed', 'status'],
      ['bad-format', 'address[0].postcode'],
    ])
  })

  test('issues carry line numbers, field names and allowed values', async () => {
    const report = await validate({ shapes, data: fixture('invalid.jsonld') })
    const status = report.documents[0]!.issues.find((i) => i.code === 'value-not-allowed')!
    expect(status.location.line).toBe(5)
    expect(status.field).toEqual({ term: 'status', iri: 'https://example.org/status' })
    expect(status.allowedValues).toEqual(['Active', 'Inactive'])
    expect(status.hint).toBe('Allowed values: Active, Inactive.')
  })

  test('the shape description supplies the example for a pattern', async () => {
    const report = await validate({ shapes, data: fixture('invalid.jsonld') })
    const postcode = report.documents[0]!.issues.find((i) => i.code === 'bad-format')!
    expect(postcode.hint).toBe('It should be a short postcode, for example `AB1`.')
  })

  test('pattern hints replace the shape description', async () => {
    const report = await validate({
      shapes,
      data: fixture('invalid.jsonld'),
      patterns: [{ pattern: '^[A-Z]{2}[0-9]$', description: 'two capitals then a digit', example: 'XY1' }],
    })
    const postcode = report.documents[0]!.issues.find((i) => i.code === 'bad-format')!
    expect(postcode.hint).toBe('It should be two capitals then a digit, for example `XY1`.')
  })

  test('several shapes files are merged', async () => {
    const data = fixture('nickname.jsonld')
    expect((await validate({ shapes, data })).conforms).toBe(true)
    const report = await validate({ shapes: [shapes, fixture('rules-shape.ttl')], data })
    expect(codesAndPaths(report.documents[0]!)).toEqual([['too-many-values', 'nickname']])
  })
})

describe('contexts', () => {
  test('a supplied context is used when the document has none', async () => {
    const report = await validate({ shapes, context: fixture('context.jsonld'), data: fixture('no-context.json') })
    expect(report.conforms).toBe(true)
    expect(report.setup.context).toBe(fixture('context.jsonld'))
    expect(codesAndPaths(report.documents[0]!)).toEqual([['assumed-context', '$']])
  })

  test("a supplied context replaces the document's own", async () => {
    const report = await validate({ shapes, context: fixture('context.jsonld'), data: fixture('valid.jsonld') })
    expect(report.conforms).toBe(true)
    expect(report.documents[0]!.issues.map((i) => i.code)).toEqual(['substituted-context'])
  })

  test('with no context anywhere the document fails rather than passing unchecked', async () => {
    const report = await validate({ shapes, data: fixture('no-context.json') })
    expect(report.conforms).toBe(false)
    expect(report.documents[0]!.issues.map((i) => [i.code, i.severity])).toEqual([['no-context', 'violation']])
  })

  test('an unreachable @context is reported, not thrown', async () => {
    const report = await validate({
      shapes,
      data: { json: { '@context': 'https://example.test/missing.jsonld', '@type': 'Person' } },
      fetch: fixtureFetch(),
    })
    const issue = report.documents[0]!.issues[0]!
    expect(issue.code).toBe('no-context')
    expect(issue.value).toContain('missing.jsonld')
    expect(issue.hint).not.toMatch(/https?:\/\//)
  })

  test('contexts can be given inline', async () => {
    const context = { json: JSON.parse(fixtureText('context.jsonld')) as unknown }
    const report = await validate({ shapes, context, data: { json: { '@type': 'Person', name: 'Ada' } } })
    expect(report.conforms).toBe(true)
  })
})

describe('sources', () => {
  test('shapes, context and data can all come from URLs, each fetched once', async () => {
    const calls: string[] = []
    const validator = await createValidator({
      shapes: 'https://example.test/person-shape.ttl',
      fetch: fixtureFetch(calls),
    })
    const report = await validator.validateAll([
      'https://example.test/valid.jsonld',
      'https://example.test/invalid.jsonld',
    ])
    expect(report.documents.map((d) => d.conforms)).toEqual([true, false])
    expect(calls.filter((u) => u.endsWith('context.jsonld'))).toHaveLength(1)
  })

  test('inline text keeps line numbers and resolves relative references against base', async () => {
    const report = await validate({
      shapes: { text: fixtureText('person-shape.ttl') },
      data: { name: 'mine.json', text: fixtureText('invalid.jsonld'), base: fixture('invalid.jsonld') },
    })
    expect(report.documents[0]!.document).toBe('mine.json')
    expect(report.documents[0]!.issues[0]!.location.line).toBeGreaterThan(0)
  })

  test('a missing optional shapes file is a warning; a missing required one is an error', async () => {
    const validator = await createValidator({
      shapes: [shapes, { path: fixture('nope.ttl'), optional: true, label: 'the nickname rules' }],
    })
    expect(validator.setup.warnings.map((w) => w.title)).toEqual([
      'the nickname rules could not be loaded - validating without it',
    ])
    await expect(createValidator({ shapes: fixture('nope.ttl') })).rejects.toBeInstanceOf(NotFoundError)
  })

  test('invalid JSON is a parse error, not an exception', async () => {
    const report = await validate({ shapes, data: fixture('broken.json') })
    expect(report.documents[0]!.issues.map((i) => i.code)).toEqual(['parse-error'])
  })
})

describe('cross-checks', () => {
  const uniqueNames: CrossCheck = {
    id: 'unique-name',
    title: 'the same name appears in several documents',
    run (documents) {
      const owners = new Map<string, string[]>()
      for (const { name, dataset } of documents) {
        for (const quad of dataset.match(null, namedNode('https://example.org/name'), null)) {
          owners.set(quad.object.value, [...(owners.get(quad.object.value) ?? []), name])
        }
      }
      const findings = [...owners].filter(([, names]) => names.length > 1)
        .map(([value, names]) => ({ message: `${value} appears ${names.length} times`, documents: names }))
      return { ok: findings.length === 0, findings }
    },
  }

  test('run across the whole batch and can fail it', async () => {
    const data = [fixture('valid.jsonld'), fixture('nickname.jsonld')]
    const report = await validate({ shapes, data, crossChecks: [uniqueNames] })
    expect(report.documents.every((d) => d.conforms)).toBe(true)
    expect(report.conforms).toBe(false)
    expect(report.crossChecks[0]).toMatchObject({ id: 'unique-name', ok: false })
  })
})

describe('skolemization', () => {
  const documents = ['valid.jsonld', 'invalid.jsonld', 'nickname.jsonld'].map(fixture)

  test('never changes a verdict', async () => {
    const shapesBoth = [shapes, fixture('rules-shape.ttl')]
    const on = await validate({ shapes: shapesBoth, data: documents })
    const off = await validate({ shapes: shapesBoth, data: documents, skolemize: false })
    expect(off.documents.map((d) => d.conforms)).toEqual(on.documents.map((d) => d.conforms))
    expect(off.documents.map((d) => d.counts)).toEqual(on.documents.map((d) => d.counts))
  })

  test('synthetic identifiers never reach any output', async () => {
    const report = await validate({ shapes, data: documents })
    for (const format of ['text', 'json', 'markdown'] as const) {
      expect(formatReport(report, format, { color: false })).not.toContain(SKOLEM_PREFIX)
    }
  })

  test('is switched off when a shape needs real blank nodes', async () => {
    const validator = await createValidator({
      shapes: [shapes, { text: '@prefix sh: <http://www.w3.org/ns/shacl#> . <urn:x> sh:nodeKind sh:BlankNode .' }],
    })
    expect(validator.skolemSafe).toBe(false)
    expect(validator.setup.warnings.map((w) => w.code)).toEqual(['shape-unavailable'])
  })
})

test('titles and hints never contain a raw IRI', async () => {
  const report = await validate({ shapes, data: ['invalid.jsonld', 'no-context.json', 'broken.json'].map(fixture) })
  for (const issue of report.documents.flatMap((d) => d.issues)) {
    expect(issue.title).not.toMatch(/https?:\/\//)
    expect(issue.hint ?? '').not.toMatch(/https?:\/\//)
  }
})
