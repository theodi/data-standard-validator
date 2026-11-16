import { describe, expect, test } from 'vitest'
import { parseCsv, CsvSyntaxError } from '../../src/document/csv.js'
import { expandTemplate, looseLabel, parseValue } from '../../src/document/csvw.js'

describe('parseCsv', () => {
  test('quoted fields may hold delimiters, quotes and line breaks', () => {
    const records = parseCsv('"a\nhelp",b\n"x, ""y""",z\n')
    expect(records.map((r) => r.cells.map((c) => c.value))).toEqual([['a\nhelp', 'b'], ['x, "y"', 'z']])
  })

  test('every cell knows where it starts and ends, across lines', () => {
    const [header, row] = parseCsv('"a\nhelp",b\nx,yy\n')
    expect(header!.cells[0]).toMatchObject({ line: 1, column: 1, endLine: 2, endColumn: 6 })
    expect(header!.cells[1]).toMatchObject({ line: 2, column: 7 })
    expect(row!.number).toBe(2)
    expect(row!.cells[1]).toMatchObject({ value: 'yy', line: 3, column: 3, endColumn: 5 })
  })

  test('CRLF, a byte order mark and a missing final newline', () => {
    const records = parseCsv('﻿a,b\r\n1,"2\r\n3"')
    expect(records.map((r) => r.cells.map((c) => c.value))).toEqual([['a', 'b'], ['1', '2\n3']])
  })

  test('empty cells and a trailing delimiter', () => {
    expect(parseCsv('a,,\n').map((r) => r.cells.map((c) => c.value))).toEqual([['a', '', '']])
    expect(parseCsv('')).toEqual([])
  })

  test('an unterminated quote is a syntax error at its start', () => {
    expect(() => parseCsv('a\n"b,c\n')).toThrow(CsvSyntaxError)
    try { parseCsv('a\n"b,c\n') } catch (error) {
      expect(error).toMatchObject({ line: 2, column: 1 })
    }
  })
})

describe('CSVW values', () => {
  const value = (text: string, base: string, format?: string | object): string | undefined => {
    const parsed = parseValue(text, { base, ...(format !== undefined ? { format } : {}) } as never)
    return parsed.ok ? `${parsed.term.value}^^${'datatype' in parsed.term ? parsed.term.datatype.value.split('#')[1] : ''}` : undefined
  }

  test('booleans follow their format, in that order', () => {
    expect(value('Yes', 'boolean', 'Yes|No')).toBe('true^^boolean')
    expect(value('Yes', 'boolean', 'No|Yes')).toBe('false^^boolean')
    expect(value('yes', 'boolean', 'Yes|No')).toBeUndefined()
    expect(value('1', 'boolean')).toBe('true^^boolean')
  })

  test('dates are rewritten as xsd:date, and impossible ones refused', () => {
    expect(value('21/03/2024', 'date', 'dd/MM/yyyy')).toBe('2024-03-21^^date')
    expect(value('1/3/2024', 'date', 'd/M/yyyy')).toBe('2024-03-01^^date')
    expect(value('31/02/2024', 'date', 'dd/MM/yyyy')).toBeUndefined()
    expect(value('2024-03-21', 'date')).toBe('2024-03-21^^date')
    expect(value('21/03/2024', 'date')).toBeUndefined()
  })

  test('numbers honour group characters and integer ranges', () => {
    expect(value('4,500.50', 'decimal', { groupChar: ',' })).toBe('4500.50^^decimal')
    expect(value('£4,500', 'decimal', { groupChar: ',' })).toBeUndefined()
    expect(value('007', 'nonNegativeInteger')).toBe('7^^nonNegativeInteger')
    expect(value('-1', 'nonNegativeInteger')).toBeUndefined()
  })

  test('URI templates percent-encode values, except with +', () => {
    expect(expandTemplate('#row-{_row}/x', { _row: '3' })).toBe('#row-3/x')
    expect(expandTemplate('{name}', { name: 'a b/c' })).toBe('a%20b%2Fc')
    expect(expandTemplate('{+name}', { name: 'a/b' })).toBe('a/b')
    expect(expandTemplate('{#_name}', { _name: 'age' })).toBe('#age')
  })

  test('labels compare without case or spaces', () => {
    expect(looseLabel('< 5 days')).toBe(looseLabel('<5 Days'))
  })
})
