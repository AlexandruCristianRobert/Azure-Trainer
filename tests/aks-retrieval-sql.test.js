import { describe, expect, it } from 'vitest'
import { parseRetrievalSql } from '../src/lib/project/retrieval-sql.js'

const sql = `SELECT id, content FROM documents
WHERE collection = %(c)s AND audience = %(a)s AND published = %(p)s
AND (embedding <=> %(v)s::vector) <= %(cutoff)s
ORDER BY embedding <=> %(v)s ASC, id ASC LIMIT %(n)s;`

describe('bounded retrieval SQL parser', () => {
  it('parses the parameterized target query and maps the named predicates', () => {
    const result = parseRetrievalSql(sql)
    expect(result.diagnostics).toEqual([])
    expect(result.querySpec).toEqual({ version: 1,
      filters: [{ column: 'collection', parameter: 'c' }, { column: 'audience', parameter: 'a' }, { column: 'published', parameter: 'p' }],
      distance: { parameter: 'v', cutoffParameter: 'cutoff' },
      order: { vectorParameter: 'v', direction: 'ASC', idDirection: 'ASC' }, limitParameter: 'n' })
  })

  it('accepts comments, case changes, quoted text and reordered conjunction terms', () => {
    const result = parseRetrievalSql(`-- Header says OR must be ignored\nselect id, content from documents /* 'AND OR' inside a comment is inert */ where published = %(p)s and audience = %(a)s and collection = %(c)s and (embedding <=> %(v)s::vector) <= %(d)s order by embedding <=> %(v)s, id limit %(n)s;`)
    expect(result.diagnostics).toEqual([])
    expect(result.querySpec.filters.map(filter => filter.column)).toEqual(['published', 'audience', 'collection'])
  })

  it.each([
    ['multiple statements', `${sql} SELECT id, content FROM documents LIMIT %(n)s;`],
    ['OR', sql.replace('AND audience', 'OR audience')],
    ['quoted placeholder', sql.replace('%(c)s', "'%(c)s'")],
    ['malformed cast', sql.replace('::vector', '::int')],
  ])('locates unsupported %s', (_label, text) => {
    const result = parseRetrievalSql(text, 'retrieval.sql')
    expect(result.querySpec).toBeNull()
    expect(result.diagnostics[0]).toMatchObject({ code: 'SQL_UNSUPPORTED', path: 'retrieval.sql', line: expect.any(Number), column: expect.any(Number) })
  })

  it('does not recognize SQL keywords or placeholders inside quoted strings', () => {
    const result = parseRetrievalSql(sql.replace('AND audience', "AND collection = 'OR %(forged)s' AND audience"))
    expect(result.querySpec).toBeNull()
    expect(result.diagnostics[0]).toMatchObject({ code: 'SQL_UNSUPPORTED', path: 'retrieval.sql' })
  })
})
