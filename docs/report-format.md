# Report format

`validate()` and `validateAll()` resolve to a `RunReport`. `data-standard-validator --format json`
prints that same object. The structure is a published contract: within a major
version, fields are only ever added.

```ts
interface RunReport {
  setup: {
    shapes: string[]        // where each shapes file came from, in merge order
    context?: string        // the supplied context, if any
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
  location: {
    jsonPath: string        // `address[0].postcode`, or `$` for the root
    pointer: string         // RFC 6901: `/address/0/postcode`
    nodeType?: string       // `@type` as written, e.g. `Address`
    nodeId?: string         // nearest `@id` the user wrote, on this node or an ancestor
    line?: number           // 1-based; present when the document was given as text
    column?: number
    endLine?: number
    endColumn?: number
    document?: string
  }
  field?: { term: string, iri: string }   // the property, as written and as an IRI
  value?: string            // the offending value, as the user wrote it
  allowedValues?: string[]  // for controlled vocabularies, as the tokens to write
  technical?: {
    focusNode: string       // a real IRI, or "(anonymous node at address[0])"
    resultPath?: string
    sourceShape?: string
    constraint: string      // e.g. `PatternConstraintComponent`
  }
}
```

## Example

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
