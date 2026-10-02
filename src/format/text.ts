/*
 * Terminal output.
 *
 * The order of a block is deliberate: the sentence first, because that is what
 * people read; then the offending line with a caret, because that is what they
 * act on; then what would have been right.
 */

import pc from 'picocolors'
import { groupIssues } from '../report/group.js'
import type { Issue, RunReport } from '../report/types.js'
import { shapesLabel, type FormatOptions } from './options.js'

const MAX_ISSUES_PER_DOCUMENT = 50

function paint (enabled: boolean) {
  const id = (s: string): string => s
  if (!enabled) return { red: id, yellow: id, green: id, cyan: id, dim: id, bold: id, magenta: id }
  return {
    red: pc.red, yellow: pc.yellow, green: pc.green,
    cyan: pc.cyan, dim: pc.dim, bold: pc.bold, magenta: pc.magenta,
  }
}

type Palette = ReturnType<typeof paint>

/** Render the `**bold**` and `` `code` `` the message layer emits. */
function inline (text: string, c: Palette): string {
  return text
    .replace(/`([^`]+)`/g, (_, s: string) => c.cyan(s))
    .replace(/\*\*([^*]+)\*\*/g, (_, s: string) => c.bold(s))
}

function codeFrame (issue: Issue, source: string | undefined, c: Palette): string[] {
  if (source === undefined || issue.location.line === undefined) return []
  // Nothing to underline when the complaint is that the field is absent; the
  // span we have is the enclosing object's, and a caret on `{` reads like a
  // parse error.
  if (issue.code === 'required-field-missing') return []

  const line = source.split('\n')[issue.location.line - 1]
  if (line === undefined) return []

  const column = issue.location.column ?? 1
  const width = issue.location.endLine === issue.location.line && issue.location.endColumn !== undefined
    ? Math.max(1, issue.location.endColumn - column)
    : 1
  const gutter = String(issue.location.line).padStart(5)
  return [
    `${c.dim(gutter)} ${c.dim('|')} ${line.replace(/\s+$/, '')}`,
    `${' '.repeat(5)} ${c.dim('|')} ${' '.repeat(Math.max(0, column - 1))}${c.red('^'.repeat(Math.min(width, 60)))}`,
  ]
}

export function renderText (report: RunReport, opts: FormatOptions = {}): string {
  const c = paint(opts.color !== false)
  const out: string[] = ['']

  out.push(`${c.bold(opts.title ?? shapesLabel(report))} ${c.dim(`· ${report.documents.length} document(s)`)}`)
  for (const warning of report.setup.warnings) {
    out.push(`  ${c.yellow('!')} ${inline(warning.title, c)}`)
    if (warning.hint !== undefined) out.push(`    ${c.dim(warning.hint)}`)
  }

  for (const doc of report.documents) {
    const verdict = doc.conforms
      ? c.green('passes')
      : doc.counts.violation === 0 ? c.yellow('warnings only') : c.red('fails')
    out.push('', `${c.bold(doc.document)} ${c.dim('->')} ${verdict}`)

    const problems = doc.issues.filter((i) => i.severity !== 'info')
    let shown = 0
    for (const group of groupIssues(problems)) {
      out.push(`  ${c.dim('in')} ${c.magenta(group.label)}`)
      for (const issue of group.issues) {
        if (shown >= MAX_ISSUES_PER_DOCUMENT) continue
        shown++
        const glyph = issue.severity === 'violation' ? c.red('x') : c.yellow('!')
        out.push(`    ${glyph} ${inline(issue.title, c)}`)
        out.push(`      ${c.dim('at')} ${c.cyan(issue.location.jsonPath)}${
          issue.location.line !== undefined ? c.dim(`  line ${issue.location.line}`) : ''}`)
        out.push(...codeFrame(issue, opts.sources?.get(doc.document), c).map((l) => `      ${l}`))
        if (issue.hint !== undefined) out.push(`      ${c.dim(issue.hint)}`)
      }
    }
    for (const note of doc.issues.filter((i) => i.severity === 'info')) {
      out.push(`  ${c.cyan('i')} ${c.dim(note.title)}`)
    }
    if (problems.length > shown) {
      out.push(`    ${c.dim(`... and ${problems.length - shown} more`)}`)
    }
  }

  for (const check of report.crossChecks) {
    if (check.ok) continue
    out.push('', `${c.bold('Across all documents')} ${c.dim('->')} ${c.red(check.title)}`)
    for (const finding of check.findings) out.push(`    ${c.red('x')} ${finding.message}`)
  }

  out.push('')
  const { violation, warning } = report.counts
  if (report.conforms && violation === 0 && warning === 0) {
    out.push(c.green(`All good - ${report.documents.length} document(s) conform.`))
  } else {
    const parts: string[] = []
    if (violation > 0) parts.push(c.red(`${violation} problem${violation === 1 ? '' : 's'}`))
    if (warning > 0) parts.push(c.yellow(`${warning} warning${warning === 1 ? '' : 's'}`))
    out.push(parts.length > 0 ? parts.join(', ') : c.red('failed'))

    const codes = new Map<string, number>()
    for (const doc of report.documents) {
      for (const issue of doc.issues) {
        if (issue.severity === 'info') continue
        codes.set(issue.code, (codes.get(issue.code) ?? 0) + 1)
      }
    }
    if (codes.size > 0) {
      out.push(c.dim(`  ${[...codes.entries()]
        .sort((a, b) => b[1] - a[1])
        .map(([code, n]) => `${n} ${code.replace(/-/g, ' ')}`)
        .join(', ')}`))
    }
  }
  out.push('')
  return out.join('\n')
}
