// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ToolCallId } from '@ahel/dsh-llm'
import type { SessionId } from '@ahel/dsh-session/types'
import { PendingApproval } from '@ahel/dsh-client-ui-approval/src/client/contract/slots.ts'
import type { ComputerUseCard } from '@ahel/dsh-computer-use-action-gate/types'
import { ComputerUseApprovalCard } from '../src/client/ApprovalCard.tsx'
import type { ApprovalCardProps } from '../src/client/contract.ts'
import { en } from '../src/client/locales.ts'
import { isComputerUseApproval } from '../src/client/view.ts'

afterEach(cleanup)

const CARD: ComputerUseCard = {
  callId: 'call-1',
  sessionId: 'session-1',
  action: 'type_text',
  summary: 'Type into “To:” text field in Mail',
  app: 'Mail',
  bundleId: 'com.apple.mail',
  window: 'New Message',
  element: { role: 'AXTextField', label: 'To:' },
  text: 'karl@example.com',
  keys: null,
  point: null,
  crop: { mimeType: 'image/png', data: 'iVBORw0KGgo=', imageWidth: 800, imageHeight: 600, x: 40, y: 60, width: 200, height: 50 },
  args: '{\n  "text": "karl@example.com"\n}',
}

const copy: Record<string, string> = en

const t: ApprovalCardProps['t'] = (key: string, params?: Record<string, unknown>) =>
  Object.entries(params ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), copy[key] ?? key)

function renderCard() {
  const pending = new PendingApproval('session-1' as SessionId, {
    toolName: 'mcp__ahel-computer__type_text', callId: 'call-1' as ToolCallId, displayReason: { en: CARD.summary },
  })
  const stop = vi.fn(() => Promise.resolve())
  const props: Partial<ApprovalCardProps> = { matched: pending, card: () => Promise.resolve(CARD), stop, t }
  render(<ComputerUseApprovalCard {...props as ApprovalCardProps} />)
  return { pending, stop }
}

describe('computer-use approval card', () => {
  it('claims only computer-use approvals', () => {
    expect(isComputerUseApproval({ kind: 'approval', toolName: 'mcp__ahel-computer__click' }, 'mcp__ahel-computer__')).toBe(true)
    expect(isComputerUseApproval({ kind: 'approval', toolName: 'bash' }, 'mcp__ahel-computer__')).toBe(false)
  })

  it('shows the target, exact text and crop, and approves only on a pointer click', async () => {
    const { pending } = renderCard()
    await screen.findByText('Mail (com.apple.mail)')
    expect(screen.getByText('New Message')).toBeTruthy()
    expect(screen.getByText('AXTextField “To:”')).toBeTruthy()
    expect(document.querySelector('[data-exact-text]')?.textContent).toBe('karl@example.com')
    expect(screen.getByRole('img', { name: en['approval.crop'] }).querySelector('img')?.getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=')

    const approve = screen.getByRole('button', { name: en.approve })
    fireEvent.keyDown(approve, { key: 'Enter' })
    fireEvent.click(approve, { detail: 0 })
    expect(pending.answerable).toBe(true)

    fireEvent.click(approve, { detail: 1 })
    await expect(pending.result).resolves.toBe('allowed-once')
  })
})
