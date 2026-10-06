import { describe, expect, it } from 'vitest'
import { acceleratorFromKey, acceleratorKeys } from '@ahel/dsh-client-ui-window-capture/client'

describe('window capture shortcut', () => {
  it('records Cmd+Shift+2 as an Electron accelerator and shows it with macOS key symbols', () => {
    const accelerator = acceleratorFromKey({ code: 'Digit2', metaKey: true, ctrlKey: false, altKey: false, shiftKey: true }, true)

    expect(accelerator).toBe('Command+Shift+2')
    expect(acceleratorKeys('CommandOrControl+Shift+2', true)).toEqual(['⌘', '⇧', '2'])
  })
})
