# CSV

CSV files are checked through [CSV on the Web (CSVW)](https://www.w3.org/TR/tabular-data-primer/)
metadata. The metadata says how each row becomes RDF, so the same SHACL shapes
can check CSV and JSON alike.

```bash
data-standard-validator -s shape.ttl --csv-metadata csv-metadata.json people.csv
```

```ts
const validator = await createValidator({ shapes, csvMetadata: 'csv-metadata.json' })
const report = await validator.validate({ name: 'upload.csv', text })
```

A document is read as CSV when its name ends in `.csv`, or when its
[source](api.md#sources) has `format: 'csv'`. Stdin is always read as JSON.

## The metadata

A minimal file: two columns, and a virtual column that types every row as a
`Person`.

```json
{
  "@context": "http://www.w3.org/ns/csvw",
  "tableSchema": {
    "aboutUrl": "#row-{_row}",
    "columns": [
      { "name": "name", "titles": "name", "propertyUrl": "https://example.org/name" },
      { "name": "age", "titles": "age", "propertyUrl": "https://example.org/age", "datatype": "integer" },
      { "name": "type", "virtual": true, "propertyUrl": "rdf:type", "valueUrl": "https://example.org/Person" }
    ]
  }
}
```

To put some columns on a nested node, give them their own `aboutUrl`, such as
`#row-{_row}/address`, and link that node to the row with another virtual
column.

The metadata describes a layout of CSV, not one file, so leave out `url`.

To learn how to write CSVW metadata, see:

- [CSV on the Web: A Primer](https://www.w3.org/TR/tabular-data-primer/)
- [Metadata Vocabulary for Tabular Data](https://www.w3.org/TR/tabular-metadata/)
- [Generating RDF from Tabular Data](https://www.w3.org/TR/csv2rdf/)

## What is supported

| Where | Supported |
| --- | --- |
| Tables | One table, or the first table of a group |
| `dialect` | `header`, `headerRowCount`, `delimiter`, `skipRows`, `trim` |
| Columns | `name`, `titles`, `virtual`, `suppressOutput`, `aboutUrl`, `propertyUrl`, `valueUrl`, `datatype`, `null`, `separator` |
| `datatype` | `string`, `boolean` (e.g. `"Yes\|No"`), integer types, `decimal`/`double`/`float` (with `groupChar`, `decimalChar`), `date` (e.g. `"dd/MM/yyyy"`), `dateTime`, `time`, `anyURI` |
| URI templates | `{name}`, `{+name}`, `{#name}`, `_row`, `_sourceRow`, `_name` |

Anything else, such as `required`, `minimum` or `primaryKey`, is ignored with a
[`csv-feature-unsupported`](error-reference.md#csv-feature-unsupported)
warning. Put those rules in the SHACL shapes instead.

## Where problems are reported

```text
people.csv -> fails
  in row 2
    x Missing required field name
      at row 2, name  line 3
    x age must be at least 0 - you gave -1
      at row 2, age  line 3
```

Every issue has a row and a column title. Header problems are reported at row 0.
The `pointer` is an [RFC 7111](https://www.rfc-editor.org/rfc/rfc7111)
fragment such as `#cell=3,2`. See [Report format](report-format.md#locations).

## How this differs from standard CSVW

| Standard CSVW | This validator | Why |
| --- | --- | --- |
| Columns are matched to the header by position | Columns are matched by title, exactly and then ignoring case | A reordered file still validates, and a missing column is named |
| A cell its `datatype` cannot read is an error | Reported as [`bad-format`](error-reference.md#bad-format) at the cell, and its text is kept | The record is not also reported as missing that field |
| A row without `aboutUrl` is a blank node | Named `#row-{_row}` | Results can be traced back to the row ([how it works](how-it-works.md)) |

## Extensions

The validator understands three extra properties. They are CSVW
[common properties](https://www.w3.org/TR/tabular-metadata/#common-properties)
in the namespace `https://theodi.github.io/data-standard-validator/ns#`. CSVW
only allows the prefixes of its own context, so write them as full IRIs. The
validator also accepts `dsv:headerMatch` and the like.

| Property | On | What it does |
| --- | --- | --- |
| `headerMatch` | table | `"first-line"` matches only the first line of each header cell |
| `valueMap` | column | Turns labels into concept IRIs: `[{ "@id", "skos:prefLabel", "skos:altLabel" }]` |
| `skipIfNodeEmpty` | virtual column | Drops the column for a row that gave its node no values |

Other CSVW tools ignore these properties, so the metadata stays valid CSVW. Those tools
will produce different RDF, though, as the example below shows.

## Example: a spreadsheet export

Take an event booking spreadsheet, exported to CSV. Each extension handles one
way a real export differs from what standard CSVW expects.

**Header cells hold help text.** The template puts guidance under each column
name, in the same cell:

```text
"ticket_type

Which ticket did the attendee buy?

Options: Day pass, Full pass (3 days)"
```

Standard CSVW would compare the whole cell with `titles`. With
`"headerMatch": "first-line"`, only `ticket_type` is compared.

**Cells hold labels, but the shapes expect IRIs.** People write
`Full pass (3 days)`, and the shape's `sh:in` lists
`https://example.org/ticket#FullPass`. A standard `valueUrl` template can only
paste the cell text into an IRI. That fails for labels with spaces or symbols,
for alternative spellings, and for differences in case. `valueMap` lists each
concept with every accepted spelling:

```json
{
  "name": "ticketType",
  "titles": "ticket_type",
  "propertyUrl": "https://example.org/ticketType",
  "https://theodi.github.io/data-standard-validator/ns#valueMap": [
    { "@id": "https://example.org/ticket#DayPass", "skos:prefLabel": "Day pass" },
    {
      "@id": "https://example.org/ticket#FullPass",
      "skos:prefLabel": "Full pass (3 days)",
      "skos:altLabel": ["Full pass", "FullPass"]
    }
  ]
}
```

Labels are matched ignoring case and spaces, so `day pass` works too. An
unknown label is kept as text, so the shape reports it with the allowed values
(`Day pass`, `Full pass (3 days)`).

**One row holds nested records.** A booking row has the attendee's details and
an optional billing address in `billing_street` and `billing_postcode`. Those
columns use `"aboutUrl": "#row-{_row}/billing"`, and virtual columns link and
type the address node:

```json
{
  "name": "link_billing", "virtual": true,
  "propertyUrl": "https://example.org/billingAddress", "valueUrl": "#row-{_row}/billing",
  "https://theodi.github.io/data-standard-validator/ns#skipIfNodeEmpty": true
},
{
  "name": "type_billing", "virtual": true, "aboutUrl": "#row-{_row}/billing",
  "propertyUrl": "rdf:type", "valueUrl": "https://example.org/Address",
  "https://theodi.github.io/data-standard-validator/ns#skipIfNodeEmpty": true
}
```

Standard CSVW always outputs virtual columns. Without `skipIfNodeEmpty`, a
booking with no billing address would still get an empty `Address`, and each
required field in it would be reported missing. With it, the address is left
out, as it would be in JSON.

## Troubleshooting

**Every column is reported missing.** The header does not match `titles`. If
header cells carry help text, add `headerMatch`.

**Everything passes unexpectedly.** Shapes with `sh:targetClass` only check
typed nodes. Check that a virtual column gives each row its `rdf:type`.
Check `setup.warnings` as well, for metadata the validator ignored.

**A value is reported as `bad-format` before any shape runs.** The column's
`datatype` cannot read it, such as `yes` when the format is `"Yes|No"`.
