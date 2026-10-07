import { describe, expect, it } from 'vitest'
import { captureFrontWindow, windowCaptureFiles } from '@ahel/dsh-window-capture'
import type { FrontWindow, WindowCapturer } from '@ahel/dsh-window-capture'

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3])

describe('window capture', () => {
  it('captures the front window that is not Ahel Desktop and builds the image, text and caption for the draft', async () => {
    const windows: (FrontWindow & { owner: number })[] = [
      { id: 1, processId: 100, owner: 100, app: 'Ahel Desktop', title: 'Chat' },
      { id: 7, processId: 200, owner: 200, app: 'Safari', title: 'Invoice #42' },
    ]
    const shot: FrontWindow[] = []
    const fake: WindowCapturer = {
      frontWindow: async exclude => windows.find(window => !exclude.includes(window.owner)),
      screenshot: async (window) => { shot.push(window); return PNG },
      text: async (_window, maxChars) => 'Total due: 120 EUR\nPay by 31 October'.slice(0, maxChars),
    }

    const result = await captureFrontWindow(fake, { excludeProcessIds: [100], maxTextChars: 1000 })

    expect(shot.map(window => window.id)).toEqual([7])
    expect(result).toEqual({ ok: true, capture: { png: PNG, app: 'Safari', title: 'Invoice #42', text: 'Total due: 120 EUR\nPay by 31 October' } })
    if (!result.ok) return
    const { files, caption } = windowCaptureFiles(result.capture, new Date(2026, 9, 7, 9, 5, 3))
    expect(caption).toBe('Window: Safari – Invoice #42')
    expect(files.map(file => [file.name, file.type])).toEqual([
      ['Window 2026-10-07 09.05.03.png', 'image/png'],
      ['Window 2026-10-07 09.05.03 text.txt', 'text/plain'],
    ])
    expect(new Uint8Array(await files[0]!.arrayBuffer())).toEqual(PNG)
    expect(await files[1]!.text()).toBe('Window: Safari – Invoice #42\n\nTotal due: 120 EUR\nPay by 31 October\n')
  })
})
