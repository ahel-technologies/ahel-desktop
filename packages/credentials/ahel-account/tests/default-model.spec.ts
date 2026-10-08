/** The Host's saved default follows the workspace: the rule chats the Host starts by itself use. */
import { describe, expect, it } from 'vitest'
import { alignedDefault } from '../src/default-model.ts'

const listed = ['anthropic/claude-sonnet-5.5', 'anthropic/claude-haiku-4.5', 'openai/gpt-5.2']

describe('alignedDefault', () => {
  it('moves the saved default to the workspace default', () => {
    expect(alignedDefault({ listed, workspaceDefault: 'openai/gpt-5.2', saved: { provider: 'ahel', model: 'anthropic/claude-haiku-4.5' }, ownKeyListed: false }))
      .toBe('openai/gpt-5.2')
    expect(alignedDefault({ listed, workspaceDefault: 'openai/gpt-5.2', saved: { provider: 'ahel', model: 'openai/gpt-5.2' }, ownKeyListed: false }))
      .toBeUndefined()
  })

  it('uses the first listed model when no default is set, not the last-used one', () => {
    expect(alignedDefault({ listed, workspaceDefault: null, saved: { provider: 'ahel', model: 'anthropic/claude-haiku-4.5' }, ownKeyListed: false }))
      .toBe('anthropic/claude-sonnet-5.5')
    expect(alignedDefault({ listed, workspaceDefault: null, saved: undefined, ownKeyListed: false })).toBe('anthropic/claude-sonnet-5.5')
    // A default ahel.ai does not list counts as none.
    expect(alignedDefault({ listed, workspaceDefault: 'gone/model', saved: undefined, ownKeyListed: false })).toBe('anthropic/claude-sonnet-5.5')
  })

  it('keeps a listed own-key model while the workspace has no default', () => {
    expect(alignedDefault({ listed, workspaceDefault: null, saved: { provider: 'deepseek', model: 'deepseek-v4-pro' }, ownKeyListed: true })).toBeUndefined()
    expect(alignedDefault({ listed, workspaceDefault: null, saved: { provider: 'deepseek', model: 'removed' }, ownKeyListed: false }))
      .toBe('anthropic/claude-sonnet-5.5')
  })

  it('with the workspace default unknown, only replaces an Ahel model the route no longer lists', () => {
    expect(alignedDefault({ listed, workspaceDefault: undefined, saved: { provider: 'ahel', model: 'anthropic/claude-haiku-4.5' }, ownKeyListed: false })).toBeUndefined()
    expect(alignedDefault({ listed, workspaceDefault: undefined, saved: { provider: 'ahel', model: 'anthropic/claude-3-opus' }, ownKeyListed: false }))
      .toBe('anthropic/claude-sonnet-5.5')
    expect(alignedDefault({ listed, workspaceDefault: undefined, saved: undefined, ownKeyListed: false })).toBeUndefined()
  })

  it('does nothing while the route lists no model', () => {
    expect(alignedDefault({ listed: [], workspaceDefault: null, saved: { provider: 'ahel', model: 'x' }, ownKeyListed: false })).toBeUndefined()
  })
})
