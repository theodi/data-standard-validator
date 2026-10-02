/*
 * One report, three ways to read it: a terminal, a program, a rendered page.
 */

import type { RunReport } from '../report/types.js'
import { renderJson } from './json.js'
import { renderMarkdown } from './markdown.js'
import { renderText } from './text.js'
import type { FormatOptions } from './options.js'

export type Format = 'text' | 'json' | 'markdown'

export const FORMATS: readonly Format[] = ['text', 'json', 'markdown']

export function formatReport (report: RunReport, format: Format = 'text', opts: FormatOptions = {}): string {
  switch (format) {
    case 'json': return renderJson(report)
    case 'markdown': return renderMarkdown(report, opts)
    case 'text': return renderText(report, opts)
    default: throw new Error(`unknown format '${String(format)}' - use ${FORMATS.join(', ')}`)
  }
}

export { renderJson, renderMarkdown, renderText }
export type { FormatOptions }
