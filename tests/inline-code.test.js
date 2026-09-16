import { describe, expect, it } from 'vitest'
import { renderInline } from '../src/lib/inlineCode.js'

describe('renderInline', () => {
  it('escapes HTML and converts backticks to <code>', () => {
    expect(renderInline('Create `rg-orders` in <West> & "Europe"')).toBe('Create <code>rg-orders</code> in &lt;West&gt; &amp; &quot;Europe&quot;')
  })
  it('handles code containing quotes and dollar signs', () => {
    expect(renderInline("filter `region = 'EU'` and `$Default`")).toBe("filter <code>region = &#39;EU&#39;</code> and <code>$Default</code>")
  })
  it('leaves unbalanced backticks alone', () => {
    expect(renderInline('a ` b')).toBe('a ` b')
  })
})
