import { describe, expect, test } from 'vitest'
import { describeConstraint, friendlyDatatype } from '../../src/report/messages.js'

const XSD = 'http://www.w3.org/2001/XMLSchema#'

describe('describeConstraint', () => {
  test('a missing required field says what to add, using the shape description', () => {
    const out = describeConstraint({
      constraint: 'MinCountConstraintComponent',
      term: 'postcode',
      facts: { minCount: 1, description: 'UK postcode in standard format (e.g. AB1 2CD).' },
      value: undefined,
    })
    expect(out.code).toBe('required-field-missing')
    expect(out.title).toContain('postcode')
    expect(out.hint).toContain('UK postcode')
  })

  test('a caller-supplied pattern hint explains the format and gives an example', () => {
    const out = describeConstraint({
      constraint: 'PatternConstraintComponent',
      term: 'postcode',
      facts: { pattern: '^[A-Z]{1,2}[0-9][0-9A-Z]? ?[0-9][A-Z]{2}$' },
      value: 'NOT A POSTCODE',
      patterns: [{
        pattern: /^\^\[A-Z\]\{1,2\}/,
        description: 'a UK postcode in upper case',
        example: 'AB1 2CD',
      }],
    })
    expect(out.code).toBe('bad-format')
    expect(out.hint).toContain('AB1 2CD')
    expect(out.title).toContain('NOT A POSTCODE')
    // The regex belongs in the technical layer, never the sentence.
    expect(out.title).not.toContain('^[A-Z]')
    expect(out.hint).not.toContain('^[A-Z]')
  })

  test('a hint can also name the exact regex source', () => {
    const out = describeConstraint({
      constraint: 'PatternConstraintComponent',
      term: 'code',
      facts: { pattern: '^[AEU]{3}$' },
      value: 'XYZ',
      patterns: [{ pattern: '^[AEU]{3}$', description: 'three letters, each A, E or U', example: 'AEU' }],
    })
    expect(out.hint).toBe('It should be three letters, each A, E or U, for example `AEU`.')
  })

  test('an unrecognised pattern falls back to the shape description', () => {
    const out = describeConstraint({
      constraint: 'PatternConstraintComponent',
      term: 'reference',
      facts: { pattern: '^ZZ[0-9]{2}-[A-F]+$', description: 'A local reference (e.g. ZZ01-ABC).' },
      value: 'nope',
    })
    expect(out.code).toBe('bad-format')
    expect(out.hint).toContain('It should be a local reference')
    expect(out.hint).toContain('ZZ01-ABC')
  })

  test('an out-of-vocabulary value lists the tokens, not the IRIs', () => {
    const out = describeConstraint({
      constraint: 'InConstraintComponent',
      term: 'genderCode',
      facts: { in: ['https://example.org/gender-code#Male'] },
      value: '7',
      allowedValues: ['1', '2', '9', 'X'],
    })
    expect(out.code).toBe('value-not-allowed')
    expect(out.hint).toBe('Allowed values: 1, 2, 9, X.')
    expect(JSON.stringify(out)).not.toContain('example.org')
  })

  test('a long vocabulary is truncated rather than dumped', () => {
    const out = describeConstraint({
      constraint: 'InConstraintComponent',
      term: 'code',
      facts: {},
      value: 'x',
      allowedValues: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'],
    })
    expect(out.hint).toContain('and 2 more')
  })

  test('too many values names the limit', () => {
    const out = describeConstraint({
      constraint: 'MaxCountConstraintComponent', term: 'name', facts: { maxCount: 1 }, value: undefined,
    })
    expect(out.code).toBe('too-many-values')
    expect(out.title).toContain('only appear once')
  })

  test('a wrong datatype is described in words', () => {
    const out = describeConstraint({
      constraint: 'DatatypeConstraintComponent',
      term: 'siblingCount',
      facts: { datatype: `${XSD}integer` },
      value: 'two',
    })
    expect(out.code).toBe('wrong-type')
    expect(out.title).toContain('a whole number')
  })

  test('a rules shape keeps its own wording', () => {
    const out = describeConstraint({
      constraint: 'NotConstraintComponent',
      term: undefined,
      facts: { message: 'When culturalNeeds is cln:Other, culturalNeedsOther must be provided.' },
      value: undefined,
    })
    expect(out.code).toBe('rule-violation')
    expect(out.title).toContain('culturalNeedsOther')
  })

  test('bounds are reported with the limit and the value', () => {
    const out = describeConstraint({
      constraint: 'MinInclusiveConstraintComponent',
      term: 'otherWeeklyCost', facts: { minInclusive: '0' }, value: '-50',
    })
    expect(out.code).toBe('out-of-range')
    expect(out.title).toContain('at least 0')
    expect(out.title).toContain('-50')
  })

  test('an unrecognised component degrades without crashing', () => {
    const out = describeConstraint({
      constraint: 'SomeFutureConstraintComponent', term: 'x', facts: {}, value: undefined,
    })
    expect(out.code).toBe('other')
    expect(out.title).toContain('SomeFuture')
  })
})

describe('friendlyDatatype', () => {
  test('knows the common XSD types', () => {
    expect(friendlyDatatype(`${XSD}boolean`)).toBe('true or false')
    expect(friendlyDatatype(`${XSD}date`)).toContain('date')
  })
})
