# Command-line reference

The package installs one command, `data-standard-validator`.

```text
data-standard-validator [options] [documents...]
```

## Running it

```bash
npx @theodi/data-standard-validator -s shape.ttl data.json  # no install needed
npm install -g @theodi/data-standard-validator              # or install globally ...
npm install -D @theodi/data-standard-validator              # ... or per project, then run `npx data-standard-validator`
```

Node.js 22 or later is required.

## Arguments and options

| Option | Description |
| --- | --- |
| `[documents...]` | The JSON or JSON-LD documents to check: file paths or `http(s)` URLs. With none, or with a single `-`, the document is read from stdin. |
| `-s, --shapes <source>` | **Required.** A SHACL shapes file in Turtle, as a path or URL. Repeat the option to merge several files, e.g. a generated shape plus hand-written rules. |
| `-c, --context <source>` | A JSON-LD context, as a path or URL. When given, it **replaces** each document's own `@context`. |
| `-f, --format <format>` | `text` (default), `json` or `markdown`. |
| `-o, --output <file>` | Write the report to a file instead of stdout. |
| `--no-color` | Plain text even in a terminal. Colour is also off when output is not a terminal, or when `NO_COLOR` is set. |
| `-V, --version` | Print the version. |
| `-h, --help` | Print usage, examples and exit codes. |

All documents given in one command are validated together. Any cross-document
checks see the whole batch, and the exit code covers all of them.

## How `@context` is chosen

JSON-LD needs a context to turn JSON keys into the IRIs the shapes talk about.
For each document:

1. If you pass `--context`, it is used. A note in the report says whether it
   was added (`assumed-context`) or replaced the document's own
   (`substituted-context`).
2. Otherwise, the document's own `@context` is used. A URL or a relative path
   (`"@context": "./context.jsonld"`) is loaded, resolved against the
   document's location.
3. If there is no context at all, the document **fails** with `no-context`. A
   plain JSON document read without a context produces no RDF. Calling it
   "valid" would mean nothing had been checked.

Use `--context` when your data is plain JSON, or when the context it names is
not the one that matches the shapes.

## Output formats

### `text` (default)

For people at a terminal. Problems are grouped by the object they are about,
with the offending line and a caret under the value:

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

The report exactly as the library returns it. The structure is documented in
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
| `1` | Problems were found, including a document that is not valid JSON. |
| `2` | Bad usage: an unknown option, or no `--shapes`. |
| `3` | A shapes file, context or document could not be loaded: a missing file, a network failure, an HTTP error, or shapes that are not valid Turtle. |

Exit code `1` follows SHACL's own definition of conformance. A result of any
severity, including `sh:Warning`, means the document does not conform.
Informational notes from the validator, such as `assumed-context`, never fail a
run.

## Recipes

**Validate everything in a folder**

```bash
data-standard-validator -s shapes/person.ttl -c shapes/context.jsonld data/*.json
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

When reading from stdin there is no file location, so a relative `@context` in
the document cannot be resolved. Pass `--context` instead.

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

**"This document has no @context, so nothing in it could be checked."** Pass
`--context`, or add an `@context` to the document.

**Everything passes, but you expected failures.** Check that the shapes target
what your documents contain. A shape with `sh:targetClass ex:Person` only
checks nodes with `"@type": "Person"`, and only if your context maps `Person`
to `ex:Person`. Keys the context does not define are silently dropped by
JSON-LD.

**Field names are shown as IRIs or compact IRIs.** The context in use does not
define a term for that property. Add one to the context.

**An issue has code `other`.** The constraint has no plain-English description
yet. Run with `-f json` to see the constraint component under `technical`, and
[open an issue](https://github.com/theodi/data-standard-validator/issues).

**Exit code 3 with `not found`.** Check the path or URL. For URLs on GitHub,
use the `raw.githubusercontent.com` address, not the page that shows the file.
