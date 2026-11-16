/*
 * The input formats the validator reads, by name.
 *
 * Adding a format means a handler here (see types.ts for what one does), an
 * entry in `InputFormat` and `FORMAT_EXTENSIONS` (load/sources.ts), and a
 * fixture pair in test/inputs.test.ts. Nothing downstream changes.
 */

import { CsvInput } from './csv.js'
import { JsonInput } from './json.js'
import type { ContextLoader, LoadedContext } from '../load/context.js'
import type { LoadedCsvw } from '../load/csvw.js'
import type { InputFormat } from '../load/sources.js'
import type { InputHandler } from './types.js'

export type { InputHandler, Preparation, Prepared, PrepareSettings } from './types.js'

/** Everything the formats need, loaded once by `createValidator`. */
export interface InputResources {
  loader: ContextLoader
  context?: LoadedContext
  csv?: LoadedCsvw
}

export function createInputs (resources: InputResources): Record<InputFormat, InputHandler> {
  return {
    json: new JsonInput(resources.loader, resources.context),
    csv: new CsvInput(resources.csv),
  }
}
