import type { RunReport } from '../report/types.js'

export interface FormatOptions {
  /** ANSI colour, for the text format. Default on; the CLI turns it off when not on a TTY. */
  color?: boolean
  /** Source text per document name, so the text format can show the offending line. */
  sources?: ReadonlyMap<string, string>
  /** Heading for the report. Defaults to the shapes' file names. */
  title?: string
}

/** `person-shape.ttl + rules.ttl` - what a reader recognises the shapes by. */
export function shapesLabel (report: RunReport): string {
  const names = report.setup.shapes.map((s) => s.split(/[/\\]/).pop() ?? s)
  return names.length > 0 ? names.join(' + ') : 'SHACL validation'
}
