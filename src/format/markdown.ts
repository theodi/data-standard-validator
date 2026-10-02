/*
 * Markdown output, for places that render it: a GitHub job summary, a pull
 * request comment, an issue. Same order as the terminal - verdict, then what is
 * wrong where, then how to fix it - but no code frames, which read badly
 * outside a monospaced terminal.
 */

import { groupIssues } from '../report/group.js'
import type { Issue, RunReport } from '../report/types.js'
import { shapesLabel, type FormatOptions } from './options.js'

const MAX_ISSUES_PER_DOCUMENT = 50

const plural = (n: number, word: string): string => `${n} ${word}${n === 1 ? '' : 's'}`

/** Text that came from the user's data must not turn into Markdown. */
function escape (text: string): string {
  return text.replace(/([\\|<>[\]])/g, '\\$1')
}

/** Inline code that survives backticks in the value itself. */
function code (text: string): string {
  const fence = text.includes('`') ? '``' : '`'
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : ''
  return `${fence}${pad}${text}${pad}${fence}`
}

/** The title and hint are already Markdown: the message layer writes `code` and **bold**. */
function issueLines (issue: Issue): string[] {
  const icon = issue.severity === 'violation' ? '❌' : '⚠️'
  const { jsonPath, line, column } = issue.location
  const where = line === undefined
    ? code(jsonPath)
    : `${code(jsonPath)}, line ${line}${column !== undefined ? `:${column}` : ''}`
  return [
    `- ${icon} ${issue.title}`,
    `  - at ${where}`,
    ...(issue.hint !== undefined ? [`  - ${issue.hint}`] : []),
  ]
}

export function renderMarkdown (report: RunReport, opts: FormatOptions = {}): string {
  const out: string[] = []
  const { violation, warning } = report.counts
  const verdict = report.conforms
    ? `✅ **Passed** - ${plural(report.documents.length, 'document')} conform`
    : `❌ **Failed** - ${[
        violation > 0 ? plural(violation, 'problem') : '',
        warning > 0 ? plural(warning, 'warning') : '',
      ].filter(Boolean).join(', ') || 'see below'}`

  out.push(`# ${escape(opts.title ?? shapesLabel(report))}`, '', verdict, '')

  if (report.setup.warnings.length > 0) {
    out.push('> [!WARNING]')
    for (const w of report.setup.warnings) {
      out.push(`> ${w.title}${w.hint !== undefined ? ` - ${escape(w.hint)}` : ''}`)
    }
    out.push('')
  }

  out.push('| Document | Result | Problems | Warnings |', '| --- | --- | ---: | ---: |')
  for (const doc of report.documents) {
    const result = doc.conforms ? '✅ passes' : doc.counts.violation === 0 ? '⚠️ warnings only' : '❌ fails'
    out.push(`| ${escape(doc.document)} | ${result} | ${doc.counts.violation} | ${doc.counts.warning} |`)
  }

  for (const doc of report.documents) {
    const problems = doc.issues.filter((i) => i.severity !== 'info')
    const notes = doc.issues.filter((i) => i.severity === 'info')
    if (problems.length === 0 && notes.length === 0) continue

    out.push('', `## ${escape(doc.document)}`)
    let shown = 0
    for (const group of groupIssues(problems)) {
      if (shown >= MAX_ISSUES_PER_DOCUMENT) break
      out.push('', `### ${escape(group.label)}`, '')
      for (const issue of group.issues) {
        if (shown >= MAX_ISSUES_PER_DOCUMENT) break
        shown++
        out.push(...issueLines(issue))
      }
    }
    if (problems.length > shown) out.push('', `_... and ${problems.length - shown} more_`)
    if (notes.length > 0) {
      out.push('')
      for (const note of notes) out.push(`> ℹ️ ${note.title}`)
    }
  }

  const failed = report.crossChecks.filter((c) => !c.ok)
  if (failed.length > 0) {
    out.push('', '## Across all documents')
    for (const check of failed) {
      out.push('', `### ${escape(check.title)}`, '')
      for (const finding of check.findings) out.push(`- ❌ ${escape(finding.message)}`)
    }
  }

  out.push('')
  return out.join('\n')
}
