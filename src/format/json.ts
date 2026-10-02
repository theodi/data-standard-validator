import type { RunReport } from '../report/types.js'

/** The report exactly as the library returns it - see docs/report-format.md. */
export function renderJson (report: RunReport): string {
  return JSON.stringify(report, null, 2)
}
