/*
 * CSV files, read through CSVW metadata.
 *
 *   parse        document/csv.ts; every cell keeps its line and column
 *   needs        CSVW metadata, loaded once for the whole run
 *   name nodes   a row without an `aboutUrl` is `#row-{_row}` of the file
 *                (CSVW would leave it a blank node), against a placeholder
 *                base when the file has no URL
 *   to RDF       document/csvw.ts, recording the cell behind every triple
 *   issues       columns missing or unexpected, cells their datatype cannot read
 *
 * CSV never goes through JSON-LD: the rows become RDF directly.
 */

import { csvToRdf } from '../document/csvw.js'
import { CsvSyntaxError } from '../document/csv.js'
import { SKOLEM_BASE } from '../document/skolemize.js'
import { csvLocator, csvProblemIssues } from '../report/csv.js'
import { noteIssue, parseErrorIssue } from '../report/types.js'
import type { LoadedCsvw } from '../load/csvw.js'
import { isUrl, type ReadResult } from '../load/sources.js'
import type { InputHandler, Preparation, PrepareSettings } from './types.js'

export class CsvInput implements InputHandler {
  readonly format = 'csv' as const

  constructor (private readonly metadata: LoadedCsvw | undefined) {}

  async prepare (read: ReadResult, settings: PrepareSettings): Promise<Preparation> {
    const name = read.name

    if (this.metadata === undefined) {
      return {
        failed: [noteIssue(
          'no-csv-metadata',
          'This is a CSV file, but there is no CSVW metadata to read it with, so nothing in it could be checked',
          'Supply the CSVW metadata that describes this layout of CSV (the csvMetadata option, or --csv-metadata).',
        )],
      }
    }

    // Rows are named relative to the table's URL. A file without one is
    // given a placeholder that the report never shows.
    const base = read.location !== undefined && isUrl(read.location)
      ? read.location
      : `${SKOLEM_BASE}${encodeURIComponent(name)}`

    let converted
    try {
      converted = csvToRdf(read.text ?? '', this.metadata.table, base, { skolemize: settings.skolemize })
    } catch (error) {
      if (!(error instanceof CsvSyntaxError)) throw error
      return { failed: [parseErrorIssue('CSV', error.message, { line: error.line, column: error.column })] }
    }
    if (converted.rows === 0) {
      return {
        failed: [{
          ...noteIssue('other', 'This CSV file has no rows of data, so nothing in it could be checked'),
          severity: 'violation',
        }],
      }
    }

    const naming = this.metadata.index
    return {
      prepared: {
        dataset: converted.dataset,
        locator: csvLocator(converted, base, name, (iri) => naming.termFor(iri)),
        naming,
        issues: csvProblemIssues(converted.problems, name),
      },
    }
  }
}
