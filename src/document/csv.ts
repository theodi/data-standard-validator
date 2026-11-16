/*
 * CSV text into records of cells, each knowing where it sits in the text.
 *
 * RFC 4180, plus what real files do: LF or CRLF line ends, a byte order mark,
 * and quoted fields that run over several lines - which is exactly how
 * spreadsheet exports put help text under a column name in the header. A
 * record therefore does not correspond to a line, and every cell carries its
 * own line and column so a problem can still be pointed at.
 */

export interface CsvCell {
  /** The value with quotes removed and `""` unescaped, but not trimmed. */
  value: string
  /** 1-based, of the cell's first character (its opening quote, if quoted). */
  line: number
  column: number
  /** Just past the cell's last character, as an editor selection would end. */
  endLine: number
  endColumn: number
}

export interface CsvRecord {
  /** 1-based position among the records, header included (RFC 7111 `row=`). */
  number: number
  cells: CsvCell[]
}

export class CsvSyntaxError extends Error {
  constructor (message: string, readonly line: number, readonly column: number) {
    super(message)
    this.name = 'CsvSyntaxError'
  }
}

export interface CsvOptions {
  delimiter?: string
}

export function parseCsv (input: string, options: CsvOptions = {}): CsvRecord[] {
  const delimiter = options.delimiter ?? ','
  if (delimiter.length !== 1 || delimiter === '"' || delimiter === '\n' || delimiter === '\r') {
    throw new CsvSyntaxError(`unsupported delimiter ${JSON.stringify(delimiter)}`, 1, 1)
  }
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input

  const records: CsvRecord[] = []
  let cells: CsvCell[] = []
  let line = 1
  let column = 1
  let i = 0

  const advance = (): void => {
    if (text[i] === '\n') { line++; column = 1 } else column++
    i++
  }

  const atRecordEnd = (): boolean => i >= text.length || text[i] === '\n' || text[i] === '\r'

  while (i < text.length || cells.length > 0) {
    const startLine = line
    const startColumn = column
    let value = ''

    if (text[i] === '"') {
      advance()
      for (;;) {
        if (i >= text.length) {
          throw new CsvSyntaxError(
            `the quoted value starting on line ${startLine} never ends - a closing " is missing`,
            startLine, startColumn,
          )
        }
        if (text[i] === '"') {
          if (text[i + 1] === '"') { value += '"'; advance(); advance(); continue }
          advance()
          break
        }
        // A CRLF inside a quoted value is one line break, as in the file.
        if (text[i] === '\r' && text[i + 1] === '\n') { advance(); continue }
        value += text[i]
        advance()
      }
      if (!atRecordEnd() && text[i] !== delimiter) {
        throw new CsvSyntaxError(
          `unexpected text after the closing quote on line ${line}, column ${column}`,
          line, column,
        )
      }
    } else {
      while (!atRecordEnd() && text[i] !== delimiter) {
        value += text[i]
        advance()
      }
    }

    cells.push({ value, line: startLine, column: startColumn, endLine: line, endColumn: column })

    if (i < text.length && text[i] === delimiter) {
      advance()
      continue
    }

    // End of record: a final line break does not start another one.
    records.push({ number: records.length + 1, cells })
    cells = []
    if (text[i] === '\r') { i++; column++ }
    if (text[i] === '\n') advance()
    if (i >= text.length) break
  }

  return records
}

/** A record with nothing in it - a blank line, or a row of empty cells. */
export function isBlank (record: CsvRecord): boolean {
  return record.cells.every((cell) => cell.value.trim() === '')
}
