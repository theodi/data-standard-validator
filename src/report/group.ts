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
  for (const issue of issues) {
    const { jsonPath, nodeType } = issue.location
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

    const key = `${issue.location.document ?? ''}#${nodePath || '$'}`
    const existing = groups.get(key)
    if (existing) existing.issues.push(issue)
    else groups.set(key, { label, issues: [issue] })
  }
  return [...groups.values()]
}
