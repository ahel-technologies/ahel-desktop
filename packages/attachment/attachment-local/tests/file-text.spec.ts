import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { AttachmentId } from '@ahel/dsh-attachment'
import { extractFileText } from '../src/file-text.ts'
import { renderAttachmentText } from '../src/file-context.ts'

const limits = { maxTextBytes: 200 * 1024, maxSourceBytes: 64 * 1024 * 1024 }

async function fixture(name: string): Promise<Uint8Array> {
  return new Uint8Array(await readFile(new URL(`./fixtures/${name}`, import.meta.url)))
}

describe('extractFileText', () => {
  it('reads PDF text per page and reports a PDF without a text layer', async () => {
    expect(await extractFileText(await fixture('q3-report.pdf'), limits)).toEqual({
      status: 'text',
      format: 'pdf',
      text: '--- Page 1 ---\nQ3 revenue was 41,200 EUR.\nChurn fell to 2.1 percent.\n\n--- Page 2 ---\nPage two: hiring plan for Tallinn office.',
      truncated: false,
      units: 2,
    })
    expect(await extractFileText(await fixture('scan.pdf'), limits))
      .toEqual({ status: 'no-text-layer', format: 'pdf', text: '', truncated: false, units: 1 })
  })

  it('reads Word paragraphs and table rows', async () => {
    const result = await extractFileText(await fixture('contract.docx'), limits)
    expect(result).toMatchObject({ status: 'text', format: 'docx', truncated: false })
    expect(result.text).toBe('Contract: Ahel & RIA\nNotice period is 30 days.\nParty\tRole\nKaarna\tSigner')
  })

  it('reads every spreadsheet sheet as CSV with shared strings, dates, and cached formula values', async () => {
    expect(await extractFileText(await fixture('budget.xlsx'), limits)).toEqual({
      status: 'text',
      format: 'spreadsheet',
      text: [
        '--- Sheet: Budget & plan ---',
        'Item,Cost,Due',
        'Laptops,4200,2026-10-01,,8400',
        '"Rent, ""office""",1800.5,2026-11-01 09:30',
        '',
        '--- Sheet: Team ---',
        'Name,Role',
        'Pets,CEO,TRUE',
      ].join('\n'),
      truncated: false,
      units: 2,
    })
  })

  it('reads PowerPoint slide text in presentation order', async () => {
    expect(await extractFileText(await fixture('pitch.pptx'), limits)).toEqual({
      status: 'text',
      format: 'pptx',
      text: '--- Slide 1 ---\nAhel pitch\nThe missing link for your AI\n\n--- Slide 2 ---\nPricing: Team 9 EUR per seat\n\n--- Slide 3 ---\nThank you',
      truncated: false,
      units: 3,
    })
  })

  it('keeps plain text as-is, caps it with a truncation marker, and refuses unknown binaries', async () => {
    const csv = new TextEncoder().encode('name,score\nPets,9\n')
    expect(await extractFileText(csv, limits)).toEqual({ status: 'text', format: 'text', text: 'name,score\nPets,9', truncated: false })
    const long = await extractFileText(new TextEncoder().encode('é'.repeat(100)), { ...limits, maxTextBytes: 11 })
    expect(long).toMatchObject({ text: 'ééééé', truncated: true })
    const ref = { attachmentId: AttachmentId(`sha256:${'a'.repeat(64)}`), name: 'notes.md', bytes: 200 }
    expect(renderAttachmentText([{ ref, result: long }], 1024).text)
      .toContain('<attached-file name="notes.md">\nééééé\n</attached-file>\n(truncated: only the first part of this file\'s text is included)')
    expect(await extractFileText(new Uint8Array([0, 1, 2, 3]), limits)).toMatchObject({ status: 'unsupported' })
  })
})
