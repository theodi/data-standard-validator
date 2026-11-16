/*
 * The contract every input format keeps, checked the same way for each.
 *
 * A new format adds its handler to src/input/index.ts and a case here; the
 * first test fails until it does.
 */

import { describe, expect, test } from 'vitest'
import { readFile } from 'node:fs/promises'
import { createInputs } from '../src/input/index.js'
import { ContextLoader } from '../src/load/context.js'
import { loadCsvw } from '../src/load/csvw.js'
import { loadShapes } from '../src/load/shapes.js'
import { readSource, type Environment, type InputFormat, type Source } from '../src/load/sources.js'
import { createShaclValidator } from '../src/rdf/shacl.js'
import { isSynthetic } from '../src/document/skolemize.js'
import { fixture } from './helpers.js'

const env: Environment = { readFile: (path) => readFile(path, 'utf8') }

interface Case {
  shapes: string[]
  /** A document with problems the shapes find. */
  failing: Source
  /** A document that is not valid in its own syntax. */
  broken: Source
}

const cases: Record<InputFormat, Case> = {
  json: {
    shapes: [fixture('person-shape.ttl')],
    failing: fixture('invalid.jsonld'),
    broken: fixture('broken.json'),
  },
  csv: {
    shapes: [fixture('person-shape.ttl'), fixture('csv/membership-shape.ttl')],
    failing: fixture('csv/people-invalid.csv'),
    broken: { text: 'full_name,age\n"Ada,36\n', name: 'broken.csv', format: 'csv' },
  },
}

const inputs = createInputs({
  loader: new ContextLoader(env),
  csv: await loadCsvw(fixture('csv/people-csv-metadata.json'), env),
})

describe('input formats', () => {
  test('every registered format has a case here', () => {
    expect(Object.keys(cases).sort()).toEqual(Object.keys(inputs).sort())
  })

  describe.each(Object.entries(cases) as [InputFormat, Case][])('%s', (format, c) => {
    const handler = inputs[format]

    test('is registered under its own name', () => {
      expect(handler.format).toBe(format)
    })

    test.each([true, false])('locates every SHACL result back in the source (skolemize: %s)', async (skolemize) => {
      const prepared = await handler.prepare(await readSource(c.failing, env), { skolemize })
      if (!('prepared' in prepared)) throw new Error(`could not prepare: ${prepared.failed[0]?.title}`)
      const { dataset, locator } = prepared.prepared
      expect(dataset.size).toBeGreaterThan(0)

      const shapes = await loadShapes(c.shapes, env)
      const { results } = await createShaclValidator(shapes.dataset).validate(dataset)
      expect(results.length).toBeGreaterThan(0)
      for (const result of results) {
        const focus = result.focusNode!
        const node = locator.node(focus.value)
        // Unskolemized, a node the document left anonymous may be a blank
        // node only the RDF conversion knows; anything named must be found.
        if (skolemize || focus.termType === 'NamedNode') {
          expect(node?.line, `focus ${focus.value}`).toBeGreaterThan(0)
        }
        expect(isSynthetic(locator.describe(focus.value, node))).toBe(false)
      }
    })

    test('fails with a parse error that says where', async () => {
      const prepared = await handler.prepare(await readSource(c.broken, env), { skolemize: true })
      if (!('failed' in prepared)) throw new Error('a broken document was prepared')
      expect(prepared.failed.map((i) => i.code)).toEqual(['parse-error'])
      expect(prepared.failed[0]!.location.line).toBeGreaterThan(0)
    })
  })
})
