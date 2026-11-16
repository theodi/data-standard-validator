/*
 * Grouping issues by the object they are about - a presentation concern,
 * shared by every formatter and by web pages rendering a report.
 */

import type { Issue } from './types.js'

export interface IssueGroup {
  /** `Address (address[0])` - what a reader sees as a heading. */
  label: string
  issues: Issue[]
}

export function groupIssues (issues: Issue[]): IssueGroup[] {
  const groups = new Map<string, IssueGroup>()
  const add = (key: string, label: string, issue: Issue): void => {
    const existing = groups.get(key)
    if (existing) existing.issues.push(issue)
    else groups.set(key, { label, issues: [issue] })
  }
  for (const issue of issues) {
    const { jsonPath, nodeType, cell } = issue.location
    // In a CSV file the reader's unit is the row, whichever node it became.
    if (cell !== undefined) {
      add(`${issue.location.document ?? ''}#row=${cell.row}`, cell.row === 0 ? 'the header row' : `row ${cell.row}`, issue)
      continue
    }
    // Group by the node, not the property: everything wrong with address[0].
    let nodePath = jsonPath
    if (issue.field !== undefined) {
      const suffix = `.${issue.field.term}`
      if (jsonPath.endsWith(suffix)) nodePath = jsonPath.slice(0, -suffix.length)
      else if (jsonPath === issue.field.term) nodePath = '$'
    }
    const atRoot = nodePath === '' || nodePath === '$'
    // `PlacementAvailability (placementAvailability)` says the same thing twice.
    const redundant = nodeType !== undefined && nodePath.toLowerCase() === nodeType.toLowerCase()
    const label = nodeType !== undefined
      ? (atRoot || redundant ? nodeType : `${nodeType} (${nodePath})`)
      : atRoot ? 'the document' : nodePath

    add(`${issue.location.document ?? ''}#${nodePath || '$'}`, label, issue)
  }
  return [...groups.values()]
}
