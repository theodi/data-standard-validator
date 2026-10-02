/*
 * Loading SHACL shapes: one or more Turtle sources merged into one dataset,
 * plus an honest account of anything that went missing.
 */

import { parseTurtle, rdf } from '../rdf/parse.js'
import { requiresBlankNodes } from '../rdf/shacl.js'
import { noteIssue, type Issue } from '../report/types.js'
import { NotFoundError, SourceError } from './fetch.js'
import { isOptional, labelOf, nameOf, readSource, type Environment, type Source } from './sources.js'
import type { Dataset } from 'rdf-ext'

export interface LoadedShapes {
  dataset: Dataset
  /** Where each loaded file came from, in merge order. */
  sources: string[]
  /** True when no shape needs blank nodes, so results can be traced to JSON paths. */
  skolemSafe: boolean
  warnings: Issue[]
}

export async function loadShapes (shapes: readonly Source[], env: Environment): Promise<LoadedShapes> {
  const dataset = rdf.dataset()
  const sources: string[] = []
  const warnings: Issue[] = []

  for (const source of shapes) {
    let read
    try {
      read = await readSource(source, env, 'shapes')
    } catch (error) {
      if (isOptional(source) && error instanceof NotFoundError) {
        warnings.push(noteIssue(
          'shape-unavailable',
          `${labelOf(source) ?? 'an optional shapes file'} could not be loaded - validating without it`,
          `${nameOf(source)} was not found. Everything reported is still accurate, ` +
          'but these particular checks did not run.',
        ))
        continue
      }
      throw error
    }
    if (read.text === undefined) {
      throw new SourceError(`${read.name}: shapes must be Turtle text, not JSON`, read.name)
    }
    try {
      dataset.addAll(parseTurtle(read.text, read.location))
    } catch (error) {
      throw new SourceError(`${read.name} is not valid Turtle: ${(error as Error).message}`, read.name)
    }
    sources.push(read.name)
  }

  if (sources.length === 0) throw new SourceError('no shapes could be loaded', '')

  const skolemSafe = !requiresBlankNodes(dataset)
  if (!skolemSafe) {
    warnings.push(noteIssue(
      'shape-unavailable',
      'a shape requires blank nodes, so results cannot be traced back to JSON paths',
      'Issues will name the nearest @id instead of a path.',
    ))
  }

  return { dataset, sources, skolemSafe, warnings }
}
