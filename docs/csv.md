# CSV

The validator checks CSV files through
[CSV on the Web (CSVW)](https://www.w3.org/TR/tabular-metadata/) metadata. The
metadata says which IRI each column stands for and how a row becomes RDF, the
way a JSON-LD context does for JSON. Every problem is reported at its **row and
column**.

```bash
data-standard-validator -s person-shape.ttl --csv-metadata csv-metadata.json people.csv
```

```ts
const validator = await createValidator({ shapes, csvMetadata: 'csv-metadata.json' })
const report = await validator.validate({ text, name: 'upload.csv' })
```

The same shapes check JSON and CSV alike, so one standard can accept both. The
[example](example.md) checks one shape against a document in each format.

## How a document is read as CSV

On the command line, a document is read as CSV when its path or URL ends in
`.csv`. Stdin is always read as JSON, so save CSV to a `.csv` file to check it.

From the API, a source whose name, path or URL ends in `.csv` is read as CSV.
To be explicit, add `format: 'csv'` to the [source](api.md#sources).

Text that is not valid CSV, such as a quoted value that is never closed, fails
with [`parse-error`](error-reference.md#parse-error), located where the syntax
broke. A file with a header but no rows fails too.

## What a report looks like

```text
people.csv -> fails
  in row 2
    x Missing required field name
      at row 2, name  line 3
      Add `name`: The person's full name.
    x age must be at least 0 - you gave -1
      at row 2, age  line 3
          3 | ,-1
            |  ^^
```

Issues are grouped by row. Each issue's `location` has:

| Field | Example | Meaning |
| --- | --- | --- |
| `jsonPath` | `row 2, age` | The row and column as a person says them. |
| `pointer` | `#cell=3,2` | The same cell as an [RFC 7111](https://www.rfc-editor.org/rfc/rfc7111) fragment, counting the header as row 1. |
| `line`, `column` | `3`, `2` | Where the cell is in the text, with `endLine` and `endColumn`. |
| `cell` | `{ row: 2, column: "age" }` | The data row (from 1; 0 is the header) and the column's title. |
| `nodeType` | `Person` | The type a virtual column gives the row's node, if any. |

A problem in an empty cell, such as a missing required value, is reported at
that cell. A problem with the header, such as a missing column, is reported at
row 0. See [Report format](report-format.md) for the whole issue.

## The metadata

CSVW metadata maps each column to an IRI, such as the `postcode` column to
`https://example.org/postcode`. Without it, a CSV file produces no RDF and
there is nothing to check. It is loaded once, with `--csv-metadata` or the
`csvMetadata` option, and applies to every CSV document in the run. A CSV
document checked without metadata fails with
[`no-csv-metadata`](error-reference.md#no-csv-metadata).

The metadata is also how the report speaks your language. Field names are
column titles, and the values of a controlled vocabulary are shown by their
labels (see [`valueMap`](#extensions)).

### Writing the metadata

The metadata is ordinary CSVW. Each row is one record, named by the table's
`aboutUrl`. A column whose values belong to a nested object names that node with
its own `aboutUrl`. Virtual columns link the nodes together and give them
their types:

```json
{
  "@context": ["http://www.w3.org/ns/csvw", { "@language": "en" }],
  "dialect": { "header": true, "trim": true },
  "tableSchema": {
    "aboutUrl": "#row-{_row}",
    "null": ["", "N/A"],
    "columns": [
      { "name": "name", "titles": "full_name", "propertyUrl": "https://example.org/name" },
      { "name": "age", "titles": "age", "propertyUrl": "https://example.org/age", "datatype": "nonNegativeInteger" },
      {
        "name": "postcode", "titles": "postcode",
        "aboutUrl": "#row-{_row}/address", "propertyUrl": "https://example.org/postcode"
      },
      {
        "name": "link_address", "virtual": true,
        "propertyUrl": "https://example.org/address", "valueUrl": "#row-{_row}/address"
      },
      {
        "name": "type_address", "virtual": true, "aboutUrl": "#row-{_row}/address",
        "propertyUrl": "rdf:type", "valueUrl": "https://example.org/Address"
      },
      { "name": "type_row", "virtual": true, "propertyUrl": "rdf:type", "valueUrl": "https://example.org/Person" }
    ]
  }
}
```

The metadata describes a layout of CSV, not one particular file, so it has no
`url`. Rows are named relative to the document's URL. A pasted or local file is
given a placeholder URL instead, and reports never show it.

### Supported CSVW

| Where | Supported |
| --- | --- |
| Metadata | A single table, or the first table of a group. |
| `dialect` | `header`, `headerRowCount` (the first header row is matched), `delimiter`, `skipRows`, `trim`. |
| Column | `name`, `titles`, `virtual`, `suppressOutput`, `aboutUrl`, `propertyUrl`, `valueUrl`, `datatype`, `null`, `separator`. The inherited properties may be set on the table or schema. |
| `datatype` | `string`, `boolean` with a `format` such as `"Yes\|No"`, the integer types, `decimal`/`double`/`float` with `groupChar` and `decimalChar`, `date` with a `format` such as `"dd/MM/yyyy"`, `dateTime`, `time`, `anyURI`. |
| URI templates | `{name}`, `{+name}` and `{#name}` over column names, `_row`, `_sourceRow` and `_name`. Prefixes from the CSVW initial context, such as `rdf:type`, are expanded. |

Anything else in the metadata produces a
[`csv-feature-unsupported`](error-reference.md#csv-feature-unsupported) warning
in `setup.warnings`, rather than being ignored without a word. In particular,
`required`, the datatype facets such as `minimum`, and the keys of the table
schema are **not** checked. Put those constraints in the SHACL shapes, where
they apply to every format of the data.

## Where this differs from plain CSVW

- **Columns are matched by title, not by position.** A reordered file
  validates. A column the metadata expects but the file lacks is reported by
  name ([`csv-column-missing`](error-reference.md#csv-column-missing)). A
  column the metadata does not describe is a warning
  ([`csv-column-unexpected`](error-reference.md#csv-column-unexpected)). A
  title is matched exactly first, and then ignoring case.
- **Unreadable cells are reported and kept.** A cell that its `datatype` cannot
  read is reported once, at the cell, as
  [`bad-format`](error-reference.md#bad-format), with what it should look like
  ("It should be `Yes` or `No`."). Its text still goes into the RDF, so the
  record is not also reported as missing that field.
- **A row with no `aboutUrl` is named, not blank.** CSVW makes such a row a
  blank node. The validator names it `#row-{_row}` of the file instead, which
  is the CSV counterpart of [skolemizing](how-it-works.md) a JSON document. It
  adds no triples. As for JSON, this is turned off when a shape requires
  `sh:nodeKind sh:BlankNode` or when you pass `skolemize: false`, and the row
  is then a blank node, still reported by its row and column.

## Extensions

These are CSVW common properties in the namespace
`https://theodi.github.io/data-standard-validator/ns#`. CSVW only lets metadata
use the prefixes of its own initial context, so write each one either as its
full IRI or, as this validator also accepts, with the prefix `dsv:`.

| Property | On | Meaning |
| --- | --- | --- |
| `headerMatch` | table | `"first-line"`: compare only the first line of each header cell with the column's titles. This is for spreadsheet exports that put help text under the column name, in the same cell. |
| `valueMap` | column | The concepts a column may hold, as `[{ "@id", "skos:prefLabel", "skos:altLabel" }]`. A cell matching any label, ignoring case and spaces (`<5 days` matches `< 5 days`), becomes that concept's IRI. Any other value is kept as text, so the shapes' `sh:in` reports it with the permitted values, shown by their `prefLabel`. A `null` token is not null in a column whose value map uses it as a label. |
| `skipIfNodeEmpty` | virtual column | Skip the column for a row that gave no value to the node it describes: its `aboutUrl` for an `rdf:type` column, otherwise its `valueUrl`, including any node below it. This keeps an optional part of a record that was left empty out of the RDF, rather than putting it in incomplete. |

## Troubleshooting

**"This is a CSV file, but there is no CSVW metadata to read it with."** Pass
`--csv-metadata`, or the `csvMetadata` option.

**Every column is reported missing.** The header does not match the columns'
`titles`. Titles are matched exactly, then ignoring case. If the header cells
carry help text below the column name, add
[`"dsv:headerMatch": "first-line"`](#extensions).

**Everything passes, but you expected failures.** Check that the shapes target
what each row describes. A shape with `sh:targetClass ex:Person` only checks
nodes typed `ex:Person`, which in CSV means a virtual column with
`"propertyUrl": "rdf:type"` and `"valueUrl"` set to that class. Also check
`setup.warnings` for [`csv-feature-unsupported`](error-reference.md#csv-feature-unsupported):
a constraint written in the metadata, such as `required`, is not checked. Put
it in the shapes.

**A value is reported as `bad-format` before any shape is involved.** Its
column's `datatype` cannot read it, for example `yes` in a boolean column whose
`format` is `"Yes|No"`. The hint says what it should look like.
