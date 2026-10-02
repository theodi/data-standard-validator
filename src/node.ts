/*
 * Public API for Node: everything in `index.ts`, with plain strings that are
 * not URLs read as file paths.
 */

import { readFile } from 'node:fs/promises'
import * as core from './index.js'
import type { Environment, ReadResult, Source } from './load/sources.js'

export * from './index.js'

const readUtf8 = (path: string): Promise<string> => readFile(path, 'utf8')

export function createValidator (options: core.ValidatorOptions): Promise<core.Validator> {
  return core.createValidator({ readFile: readUtf8, ...options })
}

export function validate (options: core.ValidateOptions): Promise<core.RunReport> {
  return core.validate({ readFile: readUtf8, ...options })
}

export function readSource (source: Source, env: Environment = {}, fallbackName?: string): Promise<ReadResult> {
  return core.readSource(source, { readFile: readUtf8, ...env }, fallbackName)
}
