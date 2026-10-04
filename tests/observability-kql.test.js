import { beforeEach, describe, expect, it } from 'vitest'

// The assertion gives an intentional RED for the absent evaluator, rather than
// failing test collection. Once present, every test runs the actual module.
const kql = await import('../src/lib/observability/kql.js').catch(() => null)
const dataset = [
  { table: 'AppRequests', id: 'req-1', Name: 'NotifyOrder', Success: true, DurationMs: 10, OperationId: 'op-1', Properties: { size: '3.8', label: 'a|b' } },
  { table: 'AppRequests', id: 'req-2', Name: 'NotifyOrder', Success: false, DurationMs: 20, OperationId: 'op-2', Properties: { size: 'bad' } },
  { table: 'AppRequests', id: 'req-3', Name: 'AcceptOrder', Success: true, DurationMs: null, Properties: {} },
  { table: 'AppTraces', id: 'trace-1', Name: 'a|b', Message: 'trace' },
]

beforeEach(() => {
  expect(kql, 'the pure KQL evaluator must exist').not.toBeNull()
  expect(kql.parseQuery).toBeTypeOf('function')
  expect(kql.executeQuery).toBeTypeOf('function')
})

const run = (text, rows = dataset, limits) => kql.executeQuery(kql.parseQuery(text), rows, limits)

describe('bounded KQL over actual telemetry', () => {
  it('computes grouped counts, predicates, averages, and derived arithmetic', () => {
    expect(run('AppRequests | where Name == "NotifyOrder" | summarize Total=count(), Failed=countif(Success == false), MeanMs=avg(DurationMs) by Name | extend FailureRate=100.0 * Failed / Total').rows)
      .toEqual([{ Name: 'NotifyOrder', Total: 2, Failed: 1, MeanMs: 15, FailureRate: 50 }])
  })

  it('recomputes from changed input without modifying source rows', () => {
    const before = structuredClone(dataset)
    expect(run('AppRequests | summarize Total=sum(DurationMs)').rows).toEqual([{ Total: 30 }])
    const changed = structuredClone(dataset)
    changed[0].DurationMs = 40
    expect(run('AppRequests | summarize Total=sum(DurationMs)', changed).rows).toEqual([{ Total: 60 }])
    expect(dataset).toEqual(before)
  })

  it('keeps quoted pipes and escaped quotes inside literal strings', () => {
    expect(run('AppRequests | where Name == "a|b" | project Name').rows).toEqual([])
    expect(run('AppTraces | where Name == "a|b" | project Name').rows).toEqual([{ Name: 'a|b' }])
    expect(run('AppTraces | extend Text="a\\\"|b", Other=\'it\\\'s|ok\' | project Text, Other').rows)
      .toEqual([{ Text: 'a"|b', Other: "it's|ok" }])
  })

  it('preserves symbol and keyword strings as literals instead of grammar', () => {
    const literals = ['+', '-', '(', ')', '|', ',', '[', ']', '=', '==', '*', 'and', 'or', 'by', 'asc', 'desc', 'true', 'false', 'null']
    const actual = literals.map(text => {
      try { return run(`AppRequests | take 1 | extend Text="${text}" | project Text`).rows }
      catch (error) { return error.message }
    })
    expect(actual).toEqual(literals.map(Text => [{ Text }]))
    expect(run('AppRequests | where Properties["label"] == "a|b" | project Text=tostring("("), Plus="+"').rows)
      .toEqual([{ Text: '(', Plus: '+' }])
  })

  it('rejects quoted pipeline, comparison, keyword, and assignment grammar tokens', () => {
    const queries = [
      'AppRequests "|" take 1',
      'AppRequests | where 1 "==" 1',
      'AppRequests | where true "and" true',
      'AppRequests | where false "or" true',
      'AppRequests | extend X "=" 1',
      'AppRequests | project X "=" Name',
      'AppRequests | project Name "," Success',
      'AppRequests | summarize N "=" count()',
      'AppRequests | summarize count "(" ")"',
      'AppRequests | summarize N=count() "by" Name',
      'AppRequests | order "by" Name',
      'AppRequests | order by Name "asc"',
      'AppRequests | order by Name "desc"',
      'AppRequests | project X=tostring "(" Name ")"',
      'AppRequests | project X=Properties "[" "label" "]"',
      'AppRequests | project X=Properties["label" "]"',
      'AppRequests | where "(" true ")"',
    ]
    const accepted = queries.filter(query => {
      try { kql.parseQuery(query); return true }
      catch { return false }
    })
    expect(accepted).toEqual([])
  })

  it('rejects quoted signs inside numeric conversion text', () => {
    expect(run('AppRequests | take 1 | project N=toint(\'"+"3\'), D=todouble(\'"-"3\')').rows)
      .toEqual([{ N: null, D: null }])
  })

  it('applies precedence, boolean predicates, property access, and typed conversions', () => {
    expect(run('AppRequests | where Success == false or (Success == true and DurationMs >= 10 and DurationMs < 20) | project Name, N=toint(Properties["size"]), D=todouble(Properties["size"]), S=tostring(Success), Value=2+3*4-8/2').rows)
      .toEqual([
        { Name: 'NotifyOrder', N: 3, D: 3.8, S: 'true', Value: 10 },
        { Name: 'NotifyOrder', N: null, D: null, S: 'false', Value: 10 },
      ])
  })

  it('uses null for missing fields, invalid conversions, and guarded arithmetic', () => {
    expect(run('AppRequests | take 1 | project Missing, Absent=Properties["nope"], Empty=tostring(Missing), Bad=toint("3oops"), Blank=todouble(""), Zero=1/0, NullMath=Missing+1, Huge=1e308*1e308').rows)
      .toEqual([{ Missing: null, Absent: null, Empty: '', Bad: null, Blank: null, Zero: null, NullMath: null, Huge: null }])
    expect(run('AppRequests | where Missing == null').rows).toEqual([])
    expect(run('AppRequests | where Missing != 1').rows).toEqual([])
  })

  it('implements null boolean truth tables and exact numeric comparison', () => {
    expect(run('AppRequests | where Missing or true | summarize N=count()').rows).toEqual([{ N: 3 }])
    expect(run('AppRequests | where Missing and false').rows).toEqual([])
    expect(run('AppRequests | where 10 == "10"').rows).toEqual([])
    expect(run('AppRequests | where 10 != "10" | summarize N=count()').rows).toEqual([{ N: 3 }])
  })

  it('calculates every aggregate while ignoring nonnumeric sum/avg/min/max values', () => {
    expect(run('AppRequests | summarize count(), countif(Success == true), sum(DurationMs), avg(DurationMs), min(DurationMs), max(DurationMs)').rows)
      .toEqual([{ count_: 3, countif_: 2, sum_DurationMs: 30, avg_DurationMs: 15, min_DurationMs: 10, max_DurationMs: 20 }])
    expect(run('AppRequests | summarize S=sum(Properties["size"]), A=avg(Missing), L=min(Missing), H=max(Missing)').rows)
      .toEqual([{ S: 0, A: null, L: null, H: null }])
  })

  it('gives an ungrouped empty count zero and empty average null, but no empty groups', () => {
    expect(run('AppRequests | summarize N=count(), F=countif(Success == false), S=sum(DurationMs), A=avg(DurationMs), L=min(DurationMs), H=max(DurationMs)', []).rows)
      .toEqual([{ N: 0, F: 0, S: 0, A: null, L: null, H: null }])
    expect(run('AppRequests | summarize N=count() by Name', []).rows).toEqual([])
  })

  it('groups by multiple expressions without conflating string and null keys', () => {
    const rows = [
      { table: 'AppMetrics', Name: 'n', Value: null },
      { table: 'AppMetrics', Name: 'n', Value: 'null' },
      { table: 'AppMetrics', Name: 'n' },
    ]
    expect(run('AppMetrics | summarize N=count() by Name, Kind=Value', rows).rows)
      .toEqual([{ Name: 'n', Kind: null, N: 2 }, { Name: 'n', Kind: 'null', N: 1 }])
  })

  it('sorts by multiple keys with stable ties, takes rows, and evaluates extend assignments sequentially', () => {
    expect(run('AppRequests | extend A=DurationMs+1, B=A*2 | order by Success asc, DurationMs desc | take 2 | project Name, A, B').rows)
      .toEqual([{ Name: 'NotifyOrder', A: 21, B: 42 }, { Name: 'NotifyOrder', A: 11, B: 22 }])
    expect(run('AppRequests | order by DurationMs asc | project DurationMs').rows)
      .toEqual([{ DurationMs: 10 }, { DurationMs: 20 }, { DurationMs: null }])
    expect(run('AppRequests | order by DurationMs | take 1 | project DurationMs').rows).toEqual([{ DurationMs: 20 }])
    expect(run('AppRequests | take 0').rows).toEqual([])
  })

  it('selects each exact supported table and excludes internal metadata by default', () => {
    for (const table of ['AppRequests', 'AppDependencies', 'AppExceptions', 'AppTraces', 'AppMetrics']) {
      const rows = [{ table, id: 'internal', generation: 2, destinationId: 'ws', Name: table }, { table: 'unrelated', Name: 'bad' }]
      expect(run(table, rows).rows).toEqual([{ Name: table }])
      expect(run(`${table} | project id, table`, rows).rows).toEqual([{ id: 'internal', table }])
    }
  })

  it('retains frozen parsed operator lineage and input IDs despite empty projections', () => {
    const ast = kql.parseQuery('AppRequests | summarize N=count() | project N')
    const result = kql.executeQuery(ast, dataset)
    expect(result.lineage.table).toBe('AppRequests')
    expect(result.lineage.inputRowIds).toEqual(['req-1', 'req-2', 'req-3'])
    expect(result.lineage.operators.map(item => item.type)).toEqual(['summarize', 'project'])
    expect(Object.isFrozen(ast.operators[0])).toBe(true)
    const changed = structuredClone(ast)
    changed.operators[0].type = 'extend'
    expect(() => kql.executeQuery(changed, dataset)).toThrow(/AST|query/i)
    expect(run('AppRequests | extend N=3').lineage.operators.map(item => item.type)).toEqual(['extend'])
  })

  it('rejects malformed, unsupported, or trailing input at parse time', () => {
    for (const query of [
      '', 'AppRequests |', 'AppRequests || take 1', 'AppRequests | where',
      'AppRequests | project', 'AppRequests | extend X=', 'AppRequests | summarize',
      'AppRequests | take -1', 'AppRequests | take 1.5', 'AppRequests | take 1 junk',
      'AppRequests | where Name == "unfinished', 'AppRequests | where DurationMs >',
      'AppRequests | project Name,', 'AppRequests | order Name',
      'AppRequests | order by', 'AppRequests | summarize X=count(DurationMs)',
      'AppRequests | summarize X=avg()', 'AppRequests | summarize X=percentile(DurationMs,95)',
      'AppRequests | join AppTraces', 'AppRequests | union AppTraces',
      'workspace("other").AppRequests', 'Other | take 1', 'apprequests',
      'AppRequests | where matches_regex(Name,".*")', 'AppRequests | evaluate plugin()',
      'AppRequests | where globalThis.fetch("https://example.org")',
      'AppRequests | project Properties.__proto__', 'AppRequests | project x=Properties[Name]',
      'AppRequests | project Name; AppTraces', 'AppRequests | where 1e999 > 1',
      'AppRequests | extend X=1, X=2', 'AppRequests | summarize N=count() by N=Name',
    ]) expect(() => kql.parseQuery(query), query).toThrow()
  })

  it('bounds source bytes, operator count, expression nesting, and input/output rows', () => {
    expect(() => kql.parseQuery(`AppRequests | extend X="${'x'.repeat(16384)}"`)).toThrow(/limit/i)
    expect(() => kql.parseQuery(`AppRequests | extend X="${'é'.repeat(8200)}"`)).toThrow(/limit/i)
    expect(() => kql.parseQuery(`AppRequests ${'| take 1 '.repeat(17)}`)).toThrow(/limit/i)
    expect(() => kql.parseQuery(`AppRequests | where ${'('.repeat(40)}true${')'.repeat(40)}`)).toThrow(/limit/i)
    expect(() => run('AppRequests', Array.from({ length: 501 }, () => ({ table: 'AppRequests' })))).toThrow(/limit/i)
    const rows = Array.from({ length: 201 }, (_, index) => ({ table: 'AppRequests', DurationMs: index }))
    expect(() => run('AppRequests', rows)).toThrow(/limit/i)
    expect(run('AppRequests | take 200', rows).rows).toHaveLength(200)
    expect(() => run('AppRequests', dataset, { maxInputRows: 3 })).toThrow(/limit/i)
    expect(() => run('AppRequests', dataset, { maxOutputRows: 2 })).toThrow(/limit/i)
    expect(() => run('AppRequests', rows, { maxOutputRows: 500 })).toThrow(/limit/i)
    expect(() => run('AppRequests', dataset, { maxOutputRows: -1 })).toThrow(/limit/i)
  })

  it('does not alias nested output data or read inherited object properties', () => {
    const rows = [{ table: 'AppRequests', Properties: { item: ['a'] } }]
    const output = run('AppRequests | project Properties', rows).rows
    output[0].Properties.item.push('b')
    expect(rows[0].Properties.item).toEqual(['a'])
    expect(run('AppRequests | project X=Properties["constructor"]', rows).rows).toEqual([{ X: null }])
    expect(() => run('AppRequests | project __proto__=Name')).toThrow()
    expect(() => run('AppRequests', null)).toThrow(/dataset/i)
  })
})
