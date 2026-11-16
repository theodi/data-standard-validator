# Command-line reference

The package installs one command, `data-standard-validator`.

```text
data-standard-validator [options] [documents...]
```

## Running it

```bash
npx --yes @theodi/data-standard-validator -s shape.ttl data.json
npm install -g @theodi/data-standard-validator
npm install --save-dev @theodi/data-standard-validator
```

The first command runs the package without adding it to the project. After a
local installation, run it with `npx data-standard-validator`; after a global
installation, run `data-standard-validator` directly.

Node.js 22 or later is required.

## Arguments and options

| Option | Description |
| --- | --- |
| `[documents...]` | The documents to check: file paths or `http(s)` URLs, in any mix of [formats](#formats). With none, or with a single `-`, a JSON document is read from stdin. |
| `-s, --shapes <source>` | **Required.** A SHACL shapes file in Turtle, as a path or URL. Repeat the option to merge several files, e.g. a generated shape plus hand-written rules. |
| `-c, --context <source>` | For JSON documents: a JSON-LD context, as a path or URL. When given, it **replaces** each document's own `@context`. See [JSON and JSON-LD](json.md#the-context). |
| `--csv-metadata <source>` | For CSV documents: CSVW metadata, as a path or URL, saying how each row maps to RDF. See [CSV](csv.md#the-metadata). |
| `-f, --format <format>` | `text` (default), `json` or `markdown`. |
| `-o, --output <file>` | Write the report to a file instead of stdout. |
| `--no-color` | Plain text even in a terminal. Colour is also off when output is not a terminal, or when `NO_COLOR` is set. |
| `-V, --version` | Print the version. |
| `-h, --help` | Print usage, examples and exit codes. |

All documents given in one command are validated together. Any cross-document
checks see the whole batch, and the exit code covers all of them.

## Formats

Each document's format comes from its extension. Anything else is refused with
exit code `2`, before any shapes are loaded.

| Format | Extensions | Needs | Problems are reported at | Guide |
| --- | --- | --- | --- | --- |
| JSON and JSON-LD | `.json`, `.jsonld` | a JSON-LD context: `--context`, or the document's own `@context` | the JSON path and line | [JSON and JSON-LD](json.md) |
| CSV | `.csv` | CSVW metadata: `--csv-metadata` | the row, column and line | [CSV](csv.md) |

A document without what its format needs **fails** (`no-context`,
`no-csv-metadata`) rather than passing with nothing checked. Stdin is always
read as JSON.

## Output formats

### `text` (default)

For people at a terminal. Problems are grouped by the object they are about (in
a CSV file, by row), with the offending line and a caret under the value:

```text
person.json -> fails
  in Person
    x status must be one of the permitted values - you gave ex:Retired
      at status  line 5
          5 |   "status": "ex:Retired",
            |             ^^^^^^^^^^^^
      Allowed values: Active, Inactive.
```

At most 50 problems are shown per document. A summary of issue codes ends the
report.

### `json`

The structure is documented in
[report-format.md](report-format.md) and is stable within a major version.

```bash
data-standard-validator -s shape.ttl data.json -f json | jq '.documents[].issues[] | {code, path: .location.jsonPath}'
```

### `markdown`

For anything that renders Markdown: GitHub job summaries, pull request
comments, issues. It contains a verdict, a table of documents, and each problem
with its path, line and fix.

```bash
data-standard-validator -s shape.ttl data/*.json -f markdown >> "$GITHUB_STEP_SUMMARY"
```

## Exit codes

| Code | Meaning |
| --- | --- |
| `0` | Every document conforms. |
| `1` | Problems were found, including a document that is not valid JSON or CSV. |
| `2` | Bad usage: an unknown option, no `--shapes`, or a document whose extension is not `.json`, `.jsonld` or `.csv`. |
| `3` | A shapes file, context or document could not be loaded: a missing file, a network failure, an HTTP error, or shapes that are not valid Turtle. |

Exit code `1` follows SHACL's own definition of conformance. A result of any
severity, including `sh:Warning`, means the document does not conform.
Informational notes from the validator, such as `assumed-context`, never fail a
run.

## Recipes

**Validate everything in a folder**

```bash
data-standard-validator -s shapes/person.ttl -c shapes/context.jsonld data/*.json
data-standard-validator -s shapes/person.ttl --csv-metadata shapes/csv-metadata.json data/*.csv
```

**Validate JSON and CSV together.** Give both the context and the metadata, and
each document is read by its extension. One report and one exit code cover the
batch:

```bash
data-standard-validator -s shapes/person.ttl -c shapes/context.jsonld \
  --csv-metadata shapes/csv-metadata.json data/*.json data/*.csv
```

**Validate against shapes published on the web.** Pin a tag or commit in the
URL so results do not change under you:

```bash
data-standard-validator -s https://raw.githubusercontent.com/org/repo/v1.2.0/person-shape.ttl record.jsonld
```

**Pipe a document in**

```bash
curl -s https://example.org/api/person/42 | data-standard-validator -s person-shape.ttl -c context.jsonld
```

Stdin is always read as JSON; save CSV to a `.csv` file to validate it. A
document from stdin has no location, so a relative `@context` in it cannot be
resolved. Pass `--context` instead.

**GitHub Actions**

```yaml
- name: Validate data
  run: |
    npx --yes @theodi/data-standard-validator \
      -s https://example.org/shapes/person.ttl \
      data/*.json -f markdown >> "$GITHUB_STEP_SUMMARY"
```

The step fails when the data does not conform, because the exit code is `1`.
To keep the summary and still fail the job, write the Markdown report to a
file first and then append it:

```yaml
- run: npx --yes @theodi/data-standard-validator -s shape.ttl data/*.json -f markdown -o report.md
- if: always()
  run: cat report.md >> "$GITHUB_STEP_SUMMARY"
```

## Troubleshooting

Problems specific to one format, such as a missing context, a column that is
not found, or everything passing unexpectedly, are covered in each format's
guide: [JSON and JSON-LD](json.md#troubleshooting) and
[CSV](csv.md#troubleshooting).

**Exit code 2 with `.xyz files are not supported`.** Documents must end in
`.json`, `.jsonld` or `.csv`. Rename the file, or pipe JSON in on stdin.

**An issue has code `other`.** The constraint has no plain-English description
yet. Run with `-f json` to see the constraint component under `technical`, and
[open an issue](https://github.com/theodi/data-standard-validator/issues).

**Exit code 3 with `not found`.** Check the path or URL. For URLs on GitHub,
use the `raw.githubusercontent.com` address, not the page that shows the file.
