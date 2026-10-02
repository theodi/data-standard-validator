#!/usr/bin/env node
/*
 * data-standard-validator - validate JSON or JSON-LD documents against SHACL shapes.
 *
 * Exit codes are the contract for scripts:
 *   0  every document conforms
 *   1  problems were found
 *   2  bad usage
 *   3  shapes, a context or a document could not be loaded
 */

import { Command, Option } from 'commander'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'
import { createValidator, readSource, formatReport, FORMATS, SourceError } from './node.js'
import type { Format, Source } from './node.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

const EXIT_OK = 0
const EXIT_FINDINGS = 1
const EXIT_USAGE = 2
const EXIT_LOAD = 3

interface Flags {
  shapes: string[]
  context?: string
  format: Format
  output?: string
  color: boolean
}

async function readStdin (): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer)
  return Buffer.concat(chunks).toString('utf8')
}

/** Read every document up front: the text is also what the code frames quote. */
interface ReadDocument { name: string, text: string, base?: string }

async function readDocuments (args: string[]): Promise<ReadDocument[]> {
  if (args.length === 0 || (args.length === 1 && args[0] === '-')) {
    return [{ name: '(stdin)', text: await readStdin() }]
  }
  const documents: ReadDocument[] = []
  for (const arg of args) {
    const read = await readSource(arg)
    documents.push({
      name: read.name,
      text: read.text ?? '',
      ...(read.location !== undefined ? { base: read.location } : {}),
    })
  }
  return documents
}

async function run (args: string[], flags: Flags): Promise<number> {
  if (flags.shapes.length === 0) {
    process.stderr.write("data-standard-validator: no shapes given - pass at least one -s <file or URL>\n\nSee 'data-standard-validator --help'.\n")
    return EXIT_USAGE
  }

  let report
  let sources: Map<string, string>
  try {
    const validator = await createValidator({
      shapes: flags.shapes as Source[],
      ...(flags.context !== undefined ? { context: flags.context } : {}),
    })
    const documents = await readDocuments(args)
    sources = new Map(documents.map((d) => [d.name, d.text]))
    report = await validator.validateAll(documents)
  } catch (error) {
    process.stderr.write(`data-standard-validator: ${(error as Error).message}\n`)
    return error instanceof SourceError ? EXIT_LOAD : EXIT_USAGE
  }

  const toTerminal = flags.output === undefined && process.stdout.isTTY === true
  const text = `${formatReport(report, flags.format, {
    color: flags.color && toTerminal && process.env['NO_COLOR'] === undefined,
    sources,
  })}\n`

  if (flags.output !== undefined) await writeFile(flags.output, text)
  else process.stdout.write(text)

  return report.conforms ? EXIT_OK : EXIT_FINDINGS
}

const collect = (value: string, previous: string[]): string[] => [...previous, value]

const program = new Command()

program
  .name('data-standard-validator')
  .description(
    'Validate JSON or JSON-LD documents against SHACL shapes, and explain any\n' +
    'problems in plain English with the JSON path and line where they occur.',
  )
  .version(pkg.version)
  .argument('[documents...]', 'files or URLs to validate ("-" or nothing reads stdin)')
  // Repeatable rather than variadic: `-s a.ttl b.json` must not swallow the document.
  .option('-s, --shapes <source>', 'SHACL shapes in Turtle: a file or URL (repeat to merge several)', collect, [])
  .option('-c, --context <source>', "JSON-LD context file or URL; replaces each document's own @context")
  .addOption(new Option('-f, --format <format>', 'report format').choices(FORMATS).default('text'))
  .option('-o, --output <file>', 'write the report to a file instead of stdout')
  .option('--no-color', 'plain text output, even in a terminal')
  .addHelpText('after', `
Examples:
  data-standard-validator -s person-shape.ttl person.json
  data-standard-validator -s https://example.org/shapes/person.ttl -c context.jsonld data/*.json
  data-standard-validator -s shape.ttl -s rules.ttl record.jsonld --format json
  data-standard-validator -s shape.ttl record.jsonld -f markdown >> "$GITHUB_STEP_SUMMARY"
  cat record.jsonld | data-standard-validator -s shape.ttl

Exit codes:
  0  every document conforms     2  bad usage
  1  problems were found         3  shapes, a context or a document could not be loaded

Documentation: https://theodi.github.io/data-standard-validator/
`)
  .action(async (documents: string[], flags: Flags) => {
    process.exitCode = await run(documents, flags)
  })

program.exitOverride((error) => {
  // Commander's own exits (--help, --version) are successes; anything else it
  // rejects is a usage error.
  process.exit(error.exitCode === 0 ? EXIT_OK : EXIT_USAGE)
})

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`data-standard-validator: ${(error as Error).message}\n`)
  process.exitCode = EXIT_USAGE
})
