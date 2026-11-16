/*
 * A CSV file's side of the report: where a result sits in the file, and the
 * problems the conversion found before SHACL ever ran.
 *
 * People think of a CSV file as rows and columns, not as the nodes a row was
 * split into, so every location is `row 3, postcode`, whichever node the
 * column's triple was about, plus the line and column in the text for anything
 * that can highlight it.
 */

import { cellKey, type CellLocation, type CsvwDatatype, type CsvwProblem, type CsvwResult } from '../document/csvw.js'
import { isSynthetic } from '../document/skolemize.js'
import { friendlyDatatype } from './messages.js'
import type { SourceLocator } from './build.js'
import type { Issue, Location } from './types.js'

const XSD = 'http://www.w3.org/2001/XMLSchema#'

function cellLocation (cell: CellLocation): Omit<Location, 'document'> {
  return {
    jsonPath: `row ${cell.row}, ${cell.title}`,
    pointer: `#cell=${cell.sourceRow},${cell.sourceColumn}`,
    line: cell.line,
    column: cell.column,
    endLine: cell.endLine,
    endColumn: cell.endColumn,
    cell: { row: cell.row, column: cell.title },
  }
}

/** Locating within a CSV file, through the cells each triple came from. */
export function csvLocator (result: CsvwResult, base: string, name: string, nodeTypeName: (iri: string) => string | undefined): SourceLocator {
  return {
    node (iri) {
      const node = result.nodes.get(iri)
      if (node === undefined) return undefined
      const type = node.type !== undefined ? nodeTypeName(node.type) : undefined
      return {
        jsonPath: `row ${node.row.row}`,
        pointer: `#row=${node.row.sourceRow}`,
        ...(type !== undefined ? { nodeType: type } : {}),
        line: node.row.line,
        column: node.row.column,
        endLine: node.row.endLine,
        endColumn: node.row.endColumn,
        cell: { row: node.row.row },
      }
    },
    property (node, focus, property, term) {
      const cell = result.cells.get(cellKey(focus, property))
      if (cell === undefined) {
        // No column holds this property: the issue is about the row.
        return {
          location: {
            ...node,
            jsonPath: `${node.jsonPath}, ${term}`,
            cell: { row: node.cell?.row ?? 0, column: term },
          },
        }
      }
      return {
        location: { ...cellLocation(cell), ...(node.nodeType !== undefined ? { nodeType: node.nodeType } : {}) },
        ...(cell.text !== '' ? { value: cell.text } : {}),
      }
    },
    // Rows are named by IRIs this run made up when the file has no URL, so
    // show them against the file's name instead; a blank row, the way the
    // JSON side shows an anonymous node.
    describe: (focus, node) => {
      if (isSynthetic(focus) && focus.startsWith(base)) return `${name}${focus.slice(base.length)}`
      if (!/^[a-z][a-z0-9+.-]*:/i.test(focus)) return `(anonymous node at ${node?.jsonPath ?? name})`
      return focus
    },
  }
}

/** "a whole number", "Yes or No", "a date written dd/MM/yyyy" - what the cell should hold. */
function expectation (datatype: CsvwDatatype): { what: string, example?: string } {
  const { base, format } = datatype
  if (base === 'boolean' && typeof format === 'string' && format.includes('|')) {
    const [yes, no] = format.split('|') as [string, string]
    return { what: `\`${yes}\` or \`${no}\`` }
  }
  if (base === 'date' && typeof format === 'string') {
    return { what: `a date written ${format}`, example: format.replace('yyyy', '2024').replace(/MM?/, '03').replace(/dd?/, '21') }
  }
  if (base === 'nonNegativeInteger') return { what: 'a whole number, 0 or more' }
  if (base === 'positiveInteger') return { what: 'a whole number, 1 or more' }
  if (/integer|long|int|short|byte/i.test(base)) return { what: 'a whole number' }
  if (base === 'decimal' || base === 'double' || base === 'float') {
    const group = typeof format === 'object' ? format.groupChar : undefined
    return { what: `a number${group !== undefined ? ` (\`${group}\` may separate thousands)` : ''}`, example: '1250.50' }
  }
  return { what: friendlyDatatype(XSD + base) }
}

/** The conversion's own findings, worded like everything else in the report. */
export function csvProblemIssues (problems: CsvwProblem[], document: string): Issue[] {
  return problems.map((problem): Issue => {
    switch (problem.kind) {
      case 'missing-column':
        return {
          severity: 'violation',
          code: 'csv-column-missing',
          title: `The column \`${problem.title}\` is missing`,
          hint: `Add a \`${problem.title}\` column. Its header must start with \`${problem.title}\`.`,
          location: { jsonPath: 'header', pointer: '#row=1', line: 1, column: 1, document, cell: { row: 0 } },
        }
      case 'unexpected-column':
        return {
          severity: 'warning',
          code: 'csv-column-unexpected',
          title: `The column \`${problem.title}\` is not part of this standard, so it was not checked`,
          hint: 'Check the column name for typos, or remove the column.',
          location: {
            jsonPath: `header, ${problem.title}`,
            pointer: `#cell=1,${problem.sourceColumn}`,
            line: problem.cell.line,
            column: problem.cell.column,
            endLine: problem.cell.endLine,
            endColumn: problem.cell.endColumn,
            document,
            cell: { row: 0, column: problem.title },
          },
        }
      case 'bad-value': {
        const { what, example } = expectation(problem.expected)
        return {
          severity: 'violation',
          code: 'bad-format',
          title: `\`${problem.cell.title}\` is not in the expected format - you gave \`${problem.value}\``,
          hint: example !== undefined ? `It should be ${what}, for example \`${example}\`.` : `It should be ${what}.`,
          location: { ...cellLocation(problem.cell), document },
          value: problem.cell.text,
        }
      }
      case 'bad-template':
        return {
          severity: 'violation',
          code: 'other',
          title: `Row ${problem.row} could not be named from column \`${problem.column}\``,
          hint: 'The CSVW metadata builds an identifier that is not a valid URL from this row.',
          location: { jsonPath: `row ${problem.row}`, pointer: '', document, cell: { row: problem.row } },
          value: problem.message,
        }
    }
  })
}
