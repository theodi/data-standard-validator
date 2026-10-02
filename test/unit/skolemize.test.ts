import { describe, expect, test } from 'vitest'
import { skolemize, SKOLEM_PREFIX } from '../../src/document/skolemize.js'
import { ContextIndex } from '../../src/document/context-index.js'

const ctx = new ContextIndex({
  p: 'https://example.org/',
  nuc: 'https://example.org/name-use-code#',
  Name: {
    '@id': 'p:Name',
    '@context': {
      use: {
        '@id': 'p:use',
        '@type': '@vocab',
        '@context': { official: 'nuc:Official', usual: 'nuc:Usual' },
      },
    },
  },
  address: { '@id': 'p:address', '@container': '@set' },
  name: { '@id': 'p:name', '@container': '@set' },
})

describe('skolemize', () => {
  test('names anonymous nodes and records where they came from', () => {
    const doc = {
      '@id': 'ex:person-1',
      '@type': 'Person',
      address: [{ '@type': 'Address', postcode: 'AB1 2CD' }],
    }
    const { document, index, minted } = skolemize(doc, { context: ctx })

    expect(minted).toBe(1)
    const injected = (document as never as { address: { '@id': string }[] }).address[0]!['@id']
    expect(injected.startsWith(SKOLEM_PREFIX)).toBe(true)

    const loc = index.get(injected)?.[0]
    expect(loc?.jsonPath).toBe('address[0]')
    expect(loc?.pointer).toBe('/address/0')
    expect(loc?.nodeType).toBe('Address')
    expect(loc?.nodeId).toBe('ex:person-1')
  })

  test('leaves an existing @id alone and indexes it', () => {
    const { index, minted } = skolemize({ '@id': 'ex:a', '@type': 'Person' }, { context: ctx })
    expect(minted).toBe(0)
    expect(index.get('ex:a')?.[0]?.jsonPath).toBe('$')
  })

  test('does not mistake a value object for a node', () => {
    const { minted } = skolemize({ '@id': 'ex:a', label: { '@value': 'x', '@language': 'en' } })
    expect(minted).toBe(0)
  })

  test('does not mistake a @vocab string for a node', () => {
    const doc = { '@id': 'ex:a', '@type': 'Name', use: 'official' }
    const { minted } = skolemize(doc, { context: ctx })
    expect(minted).toBe(0)
  })

  test('attaches line and column when given the source text', () => {
    const text = '{\n  "@id": "ex:a",\n  "address": [ { "postcode": "X" } ]\n}'
    const { index } = skolemize(JSON.parse(text), { text, context: ctx })
    const loc = [...index.values()].flat().find((l) => l.jsonPath === 'address[0]')
    expect(loc?.line).toBe(3)
    expect(loc?.column).toBeGreaterThan(1)
  })

  test('indexes a node that appears at several positions', () => {
    const doc = {
      '@id': 'ex:root',
      name: [{ '@id': 'ex:shared' }, { '@id': 'ex:shared' }],
    }
    const { index } = skolemize(doc, { context: ctx })
    expect(index.get('ex:shared')).toHaveLength(2)
    expect(index.get('ex:shared')?.map((l) => l.jsonPath)).toEqual(['name[0]', 'name[1]'])
  })

  test('does not mutate the input', () => {
    const doc = { '@type': 'Person', address: [{ '@type': 'Address' }] }
    const before = JSON.stringify(doc)
    skolemize(doc, { context: ctx })
    expect(JSON.stringify(doc)).toBe(before)
  })

  test('walks into @list wrappers', () => {
    const doc = { '@id': 'ex:a', items: { '@list': [{ '@type': 'Thing' }] } }
    const { minted } = skolemize(doc)
    expect(minted).toBe(1)
  })
})
