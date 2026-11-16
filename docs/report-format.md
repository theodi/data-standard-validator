# Report format

`validate()` and `validateAll()` resolve to a `RunReport`. `data-standard-validator --format json`
prints that same object. The structure is a published contract: within a major
version, fields are only ever added.

The report is the same for every input format. A JSON document and a CSV file
checked against the same shapes produce the same issue codes, titles and hints.
Only the [location](#locations) is told in each format's own terms.

```ts
interface RunReport {
  setup: {
    shapes: string[]        // where each shapes file came from, in merge order
    context?: string        // the JSON-LD context JSON documents are read with, if supplied
    csvMetadata?: string    // the CSVW metadata CSV documents are read with, if supplied
    warnings: Issue[]       // e.g. an optional shapes file that was not found
  }
  documents: DocumentReport[]
  crossChecks: CrossCheckReport[]
  conforms: boolean         // every document conforms and every cross-check passed
  counts: { violation: number, warning: number, info: number }
}

interface DocumentReport {
  document: string          // the path, URL or name given
  conforms: boolean
  counts: { violation: number, warning: number, info: number }
  issues: Issue[]           // violations first, then by line
}

interface CrossCheckReport {
  id: string
  title: string
  ok: boolean
  findings: { message: string, documents: string[] }[]
}
```

## Issues

Every issue has two layers. The **human layer** (`title`, `hint`, `location`,
`value`, `allowedValues`) never contains a raw IRI and is safe to show anyone.
The **`technical`** layer is for people who know SHACL. It is what makes a bug
report actionable.

```ts
interface Issue {
  severity: 'violation' | 'warning' | 'info'
  code: IssueCode           // see error-reference.md
  title: string             // one line, plain English; may contain `code` and **bold**
  hint?: string             // what to do about it
  location: {               // see Locations, below
    jsonPath: string        // where, as a person says it
    pointer: string         // where, as a standard fragment
    nodeType?: string       // the type of the thing the issue is about, e.g. `Address`
    nodeId?: string         // JSON: the nearest `@id` the user wrote
    line?: number           // 1-based; present when the document was given as text
    column?: number
    endLine?: number
    endColumn?: number
    document?: string
    cell?: { row: number, column?: string }  // CSV: the data row and column title
  }
  field?: { term: string, iri: string }   // the property as the document names it, and as an IRI
  value?: string            // the offending value, as the user wrote it
  allowedValues?: string[]  // for controlled vocabularies, as the tokens to write
  technical?: {
    focusNode: string       // a real IRI, "(anonymous node at address[0])", or "people.csv#row-2"
    resultPath?: string
    sourceShape?: string
    constraint: string      // e.g. `PatternConstraintComponent`
  }
}
```

## Locations

`location` says where an issue is in the format the document was written in.
`line` and `column` mean the same thing in every format: the place in the
text, which is what the text report's code frame underlines.

| Field | JSON and JSON-LD | CSV |
| --- | --- | --- |
| `jsonPath` | `address[0].postcode`, or `$` for the whole document | `row 3, postcode`, or `header` |
| `pointer` | [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901) JSON Pointer: `/address/0/postcode` | [RFC 7111](https://www.rfc-editor.org/rfc/rfc7111) fragment, counting the header as row 1: `#cell=4,2` |
| `nodeType` | the object's `@type`, as written | the type a virtual column gives the row's node |
| `nodeId` | the nearest `@id` on this object or one around it | not used |
| `cell` | not used | `{ row, column }`: the data row (from 1; 0 is the header) and the column's title |
| `field.term` | the key, as the context names it | the column's title |
| `allowedValues` | the tokens the context defines | the labels the metadata's `valueMap` defines |

Issues are grouped for display by the object they are about: in JSON, by
object (`Address (address[0])`); in CSV, by row (`row 3`). `groupIssues()` does
the same for your own pages. See the guides for
[JSON and JSON-LD](json.md#what-a-report-looks-like) and
[CSV](csv.md#what-a-report-looks-like).

## Examples

### A JSON document

```json
{
  "setup": { "shapes": ["person-shape.ttl"], "warnings": [] },
  "documents": [
    {
      "document": "person.json",
      "conforms": false,
      "counts": { "violation": 1, "warning": 0, "info": 0 },
      "issues": [
        {
          "severity": "violation",
          "code": "value-not-allowed",
          "title": "`status` must be one of the permitted values - you gave `ex:Retired`",
          "hint": "Allowed values: Active, Inactive.",
          "location": {
            "jsonPath": "status", "pointer": "/status", "nodeType": "Person",
            "line": 5, "column": 13, "endLine": 5, "endColumn": 25, "document": "person.json"
          },
          "field": { "term": "status", "iri": "https://example.org/status" },
          "value": "ex:Retired",
          "allowedValues": ["Active", "Inactive"],
          "technical": {
            "focusNode": "(anonymous node at $)",
            "resultPath": "https://example.org/status",
            "sourceShape": "n3-2",
            "constraint": "InConstraintComponent"
          }
        }
      ]
    }
  ],
  "crossChecks": [],
  "conforms": false,
  "counts": { "violation": 1, "warning": 0, "info": 0 }
}
```

### A CSV file

One issue from the [example](example.md): `-1` in the `age` column of the
second row. Only `location` and `technical.focusNode` differ from the issue a
JSON document with the same mistake gets:

```json
{
  "severity": "violation",
  "code": "out-of-range",
  "title": "`age` must be at least 0 - you gave `-1`",
  "location": {
    "jsonPath": "row 2, age",
    "pointer": "#cell=3,2",
    "line": 3,
    "column": 2,
    "endLine": 3,
    "endColumn": 4,
    "cell": { "row": 2, "column": "age" },
    "nodeType": "Person",
    "document": "people.csv"
  },
  "field": { "term": "age", "iri": "https://example.org/age" },
  "value": "-1",
  "technical": {
    "focusNode": "people.csv#row-2",
    "resultPath": "https://example.org/age",
    "sourceShape": "n3-1",
    "constraint": "MinInclusiveConstraintComponent"
  }
}
```
