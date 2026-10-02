import { describe, expect, test } from 'vitest'
import { isUrl, readSource, SourceError, NotFoundError } from '../src/index.js'
import { resolveRelative } from '../src/load/sources.js'
import { fixtureFetch } from './helpers.js'

describe('isUrl', () => {
  test.each([
    ['https://example.org/a.ttl', true],
    ['http://localhost:8080/x', true],
    ['shapes/person.ttl', false],
    ['/abs/path.ttl', false],
    ['C:\\data\\x.json', false],
  ])('%s -> %s', (value, expected) => {
    expect(isUrl(value)).toBe(expected)
  })
})

describe('resolveRelative', () => {
  test('against a URL', () => {
    expect(resolveRelative('./context.jsonld', 'https://example.org/data/x.json'))
      .toBe('https://example.org/data/context.jsonld')
  })
  test('against a path', () => {
    expect(resolveRelative('./context.jsonld', 'data/x.json')).toBe('data/./context.jsonld')
    expect(resolveRelative('context.jsonld', 'x.json')).toBe('context.jsonld')
  })
  test('absolute references are left alone', () => {
    expect(resolveRelative('https://a.test/c', 'data/x.json')).toBe('https://a.test/c')
    expect(resolveRelative('/etc/c.jsonld', 'data/x.json')).toBe('/etc/c.jsonld')
  })
})

describe('readSource', () => {
  test('the browser build refuses file paths with a clear message', async () => {
    await expect(readSource('shape.ttl', {})).rejects.toThrow(/file paths need Node/)
  })

  test('a 404 is a NotFoundError, other HTTP failures a SourceError', async () => {
    await expect(readSource('https://example.test/none.ttl', { fetch: fixtureFetch() }))
      .rejects.toBeInstanceOf(NotFoundError)
    const failing = (async () => new Response('', { status: 500 })) as typeof fetch
    await expect(readSource('https://example.test/x', { fetch: failing })).rejects.toBeInstanceOf(SourceError)
  })

  test('a missing file is a NotFoundError', async () => {
    const readFile = async (): Promise<string> => { throw Object.assign(new Error('nope'), { code: 'ENOENT' }) }
    await expect(readSource('missing.ttl', { readFile })).rejects.toBeInstanceOf(NotFoundError)
  })

  test('inline sources are named and keep their base', async () => {
    expect(await readSource({ text: 'x', name: 'a', base: 'dir/a.json' }, {}))
      .toEqual({ name: 'a', location: 'dir/a.json', text: 'x' })
    expect(await readSource({ json: { a: 1 } }, {})).toEqual({ name: 'document', json: { a: 1 } })
  })
})
