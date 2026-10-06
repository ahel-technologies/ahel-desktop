/** Model-readable text from stored PDF, Office, spreadsheet, and plain-text files. @module @ahel/dsh-attachment-local/file-text */

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { unzipSync, type Unzipped } from 'fflate'
import type { FileAttachmentRef, FileAttachmentText, FileTextFormat } from '@ahel/dsh-attachment'
import { readFileStreamVerbatim } from './file-store.ts'

/** Default per-file cap on extracted text, in UTF-8 bytes. */
export const DEFAULT_MAX_FILE_TEXT_BYTES = 200 * 1024
/** Default largest stored file read for extraction; a larger plain-text file keeps its prefix. */
export const DEFAULT_MAX_FILE_TEXT_SOURCE_BYTES = 64 * 1024 * 1024

/** Resolved extraction bounds. */
export interface FileTextLimits {
  /** Cap on extracted text per file, in UTF-8 bytes. */
  readonly maxTextBytes: number
  /** Largest file whose bytes are read for extraction. */
  readonly maxSourceBytes: number
}
/** Spreadsheet rows read per sheet; the text cap usually binds first. */
const MAX_SHEET_ROWS = 20_000
/** Bumped when extraction output changes so cached sidecars are re-derived. */
const FILE_TEXT_VERSION = 1

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]
const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]
const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((value, index) => bytes[index] === value)
}

/** Cut text at the per-file cap on a code point boundary. */
function capText(text: string, cap: number): { text: string; truncated: boolean } {
  const bytes = Buffer.from(text, 'utf8')
  if (bytes.byteLength <= cap) return { text, truncated: false }
  return { text: bytes.subarray(0, cap).toString('utf8').replace(/�+$/u, ''), truncated: true }
}

function textResult(
  limits: FileTextLimits, format: FileTextFormat, text: string, units?: number, truncated = false,
): FileAttachmentText {
  const capped = capText(text.replace(/\r\n?/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim(), limits.maxTextBytes)
  return {
    status: 'text',
    format,
    text: capped.text,
    truncated: truncated || capped.truncated,
    ...units === undefined ? {} : { units },
  }
}

const XML_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: '\'' }

function decodeXml(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/giu, (_match, entity: string) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    return XML_ENTITIES[entity.toLowerCase()] ?? ''
  })
}

/**
 * Walk OOXML text runs. `textTag` holds run text; paragraph ends become line
 * breaks, table cells become tabs inside one line per row.
 */
function ooxmlText(xml: string, prefix: 'w' | 'a'): string {
  let out = ''
  let inText = false
  let cellDepth = 0
  for (const match of xml.matchAll(/<[^>]*>|[^<]+/gu)) {
    const piece = match[0]
    if (!piece.startsWith('<')) {
      if (inText) out += decodeXml(piece)
      continue
    }
    const tag = /^<(\/?)([\w.-]+):([\w.-]+)/u.exec(piece)
    if (tag === null || tag[2] !== prefix) continue
    const closing = tag[1] === '/'
    const selfClosing = piece.endsWith('/>')
    switch (tag[3]) {
      case 't':
        inText = !closing && !selfClosing
        break
      case 'tab':
        if (!closing) out += '\t'
        break
      case 'br':
      case 'cr':
        if (!closing) out += '\n'
        break
      case 'p':
        if (closing) out += cellDepth > 0 ? ' ' : '\n'
        break
      case 'tc':
        if (closing) {
          cellDepth = Math.max(0, cellDepth - 1)
          out = `${out.trimEnd()}\t`
        } else if (!selfClosing) cellDepth += 1
        break
      case 'tr':
        if (closing) out = `${out.trimEnd()}\n`
        break
      default:
        break
    }
  }
  return out
}

function unzipEntries(limits: FileTextLimits, bytes: Uint8Array, wanted: (name: string) => boolean): Unzipped {
  return unzipSync(bytes, {
    filter: file => wanted(file.name) && file.originalSize <= limits.maxSourceBytes,
  })
}

function entryText(entries: Unzipped, name: string): string | undefined {
  const entry = entries[name]
  return entry === undefined ? undefined : Buffer.from(entry).toString('utf8')
}

function docxText(limits: FileTextLimits, bytes: Uint8Array): FileAttachmentText {
  const xml = entryText(unzipEntries(limits, bytes, name => name === 'word/document.xml'), 'word/document.xml')
  if (xml === undefined) return { status: 'failed', format: 'docx', text: '', truncated: false, reason: 'word/document.xml is missing' }
  return textResult(limits, 'docx', ooxmlText(xml, 'w'))
}

/** Slide parts in presentation order, falling back to their file numbers. */
function slideOrder(entries: Unzipped): string[] {
  const slides = Object.keys(entries)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/u.test(name))
    .sort((a, b) => Number(/(\d+)\.xml$/u.exec(a)?.[1]) - Number(/(\d+)\.xml$/u.exec(b)?.[1]))
  const presentation = entryText(entries, 'ppt/presentation.xml')
  const rels = entryText(entries, 'ppt/_rels/presentation.xml.rels')
  if (presentation === undefined || rels === undefined) return slides
  const targets = new Map<string, string>()
  for (const rel of rels.matchAll(/<Relationship\b[^>]*>/gu)) {
    const id = /\bId="([^"]+)"/u.exec(rel[0])?.[1]
    const target = /\bTarget="([^"]+)"/u.exec(rel[0])?.[1]
    if (id !== undefined && target !== undefined) targets.set(id, `ppt/${target.replace(/^\/?ppt\//u, '').replace(/^\.\//u, '')}`)
  }
  const ordered = [...presentation.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/gu)]
    .map(match => targets.get(match[1] as string))
    .filter((name): name is string => name !== undefined && slides.includes(name))
  return ordered.length === 0 ? slides : [...ordered, ...slides.filter(name => !ordered.includes(name))]
}

function pptxText(limits: FileTextLimits, bytes: Uint8Array): FileAttachmentText {
  const entries = unzipEntries(limits, bytes, name => name.startsWith('ppt/slides/slide')
    || name === 'ppt/presentation.xml' || name === 'ppt/_rels/presentation.xml.rels')
  const slides = slideOrder(entries)
  const text = slides.map((name, index) => `--- Slide ${index + 1} ---\n${ooxmlText(entryText(entries, name) ?? '', 'a').trim()}`)
  return textResult(limits, 'pptx', text.join('\n\n'), slides.length)
}

const BUILTIN_DATE_FORMATS = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47, 50, 57])

function attribute(tag: string, name: string): string | undefined {
  const value = new RegExp(`\\s${name}="([^"]*)"`, 'u').exec(tag)?.[1]
  return value === undefined ? undefined : decodeXml(value)
}

/** Concatenated `<t>` text of one string item, skipping phonetic runs. */
function runText(xml: string): string {
  return decodeXml([...xml.replace(/<(?:\w+:)?rPh\b[\s\S]*?<\/(?:\w+:)?rPh>/gu, '')
    .matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?t>/gu)].map(match => match[1]).join(''))
}

/** Style indexes whose number format renders dates. */
function dateStyles(styles: string | undefined): Set<number> {
  const result = new Set<number>()
  if (styles === undefined) return result
  const custom = new Map<number, string>()
  for (const match of styles.matchAll(/<(?:\w+:)?numFmt\b[^>]*>/gu)) {
    custom.set(Number(attribute(match[0], 'numFmtId')), attribute(match[0], 'formatCode') ?? '')
  }
  const cellXfs = /<(?:\w+:)?cellXfs\b[\s\S]*?<\/(?:\w+:)?cellXfs>/u.exec(styles)?.[0] ?? ''
  let index = 0
  for (const match of cellXfs.matchAll(/<(?:\w+:)?xf\b[^>]*>/gu)) {
    const id = Number(attribute(match[0], 'numFmtId') ?? 0)
    const code = custom.get(id)?.replace(/"[^"]*"|\[[^\]]*\]|\\./gu, '')
    if (BUILTIN_DATE_FORMATS.has(id) || (code !== undefined && /[dmyhs]/iu.test(code))) result.add(index)
    index += 1
  }
  return result
}

/** Render an Excel serial date as ISO text. */
function serialDate(serial: number, date1904: boolean): string {
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const iso = new Date(epoch + Math.round(serial * 86_400) * 1000).toISOString()
  if (Number.isInteger(serial)) return iso.slice(0, 10)
  return iso.endsWith(':00.000Z') ? `${iso.slice(0, 10)} ${iso.slice(11, 16)}` : `${iso.slice(0, 10)} ${iso.slice(11, 19)}`
}

function columnIndex(reference: string | undefined, fallback: number): number {
  const letters = reference === undefined ? undefined : /^([A-Z]+)/u.exec(reference)?.[1]
  if (letters === undefined) return fallback
  let index = 0
  for (const letter of letters) index = index * 26 + letter.charCodeAt(0) - 64
  return index - 1
}

function csvField(value: string): string {
  return /[",\r\n]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value
}

function sheetCsv(
  xml: string, shared: readonly string[], dates: ReadonlySet<number>, date1904: boolean,
): { csv: string; truncated: boolean } {
  const lines: string[] = []
  let truncated = false
  for (const row of xml.matchAll(/<(?:\w+:)?row\b[^>]*?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/gu)) {
    if (lines.length >= MAX_SHEET_ROWS) {
      truncated = true
      break
    }
    const cells: (string | undefined)[] = []
    for (const cell of (row[1] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/gu)) {
      const tag = ` ${cell[1] ?? ''}`
      const body = cell[2] ?? ''
      const type = attribute(tag, 't')
      const raw = /<(?:\w+:)?v(?:\s[^>]*)?>([^<]*)<\/(?:\w+:)?v>/u.exec(body)?.[1]
      let value: string
      if (type === 's') value = shared[Number(raw)] ?? ''
      else if (type === 'inlineStr') value = runText(body)
      else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE'
      else if (raw === undefined) value = ''
      else if (type === undefined || type === 'n') {
        const style = Number(attribute(tag, 's') ?? 0)
        const number = Number(raw)
        value = dates.has(style) && Number.isFinite(number) ? serialDate(number, date1904) : raw
      } else value = decodeXml(raw)
      cells[columnIndex(attribute(tag, 'r'), cells.length)] = value
    }
    const line = Array.from(cells, value => csvField(value ?? '')).join(',')
    if (line.replaceAll(',', '') !== '') lines.push(line)
  }
  return { csv: lines.join('\n'), truncated }
}

function spreadsheetText(limits: FileTextLimits, bytes: Uint8Array): FileAttachmentText {
  const entries = unzipEntries(limits, bytes, name => (name.startsWith('xl/') && name.endsWith('.xml')) || name.endsWith('.rels'))
  const workbook = entryText(entries, 'xl/workbook.xml')
  if (workbook === undefined) return { status: 'failed', format: 'spreadsheet', text: '', truncated: false, reason: 'xl/workbook.xml is missing' }
  const targets = new Map<string, string>()
  for (const rel of (entryText(entries, 'xl/_rels/workbook.xml.rels') ?? '').matchAll(/<(?:\w+:)?Relationship\b[^>]*>/gu)) {
    const id = attribute(rel[0], 'Id')
    const target = attribute(rel[0], 'Target')
    if (id !== undefined && target !== undefined) targets.set(id, target.startsWith('/') ? target.slice(1) : `xl/${target}`)
  }
  const shared = [...(entryText(entries, 'xl/sharedStrings.xml') ?? '').matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/gu)]
    .map(match => runText(match[1] ?? ''))
  const dates = dateStyles(entryText(entries, 'xl/styles.xml'))
  const date1904 = /<(?:\w+:)?workbookPr\b[^>]*\sdate1904="(?:1|true)"/u.test(workbook)
  let truncated = false
  const sheets = [...workbook.matchAll(/<(?:\w+:)?sheet\b[^>]*>/gu)].map((match) => {
    const name = attribute(match[0], 'name') ?? 'Sheet'
    const id = attribute(match[0], 'r:id')
    const xml = id === undefined ? undefined : entryText(entries, targets.get(id) ?? '')
    const sheet = xml === undefined ? { csv: '', truncated: false } : sheetCsv(xml, shared, dates, date1904)
    truncated ||= sheet.truncated
    return `--- Sheet: ${name} ---\n${sheet.csv}`
  })
  return textResult(limits, 'spreadsheet', sheets.join('\n\n'), sheets.length, truncated)
}

interface PdfTextItem { str?: string; hasEOL?: boolean }

async function pdfText(limits: FileTextLimits, bytes: Uint8Array, signal?: AbortSignal): Promise<FileAttachmentText> {
  const { getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(bytes), { verbosity: 0 })
  try {
    const pages: string[] = []
    let size = 0
    for (let number = 1; number <= pdf.numPages && size <= limits.maxTextBytes; number++) {
      signal?.throwIfAborted()
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      const text = (content.items as PdfTextItem[]).map(item => (item.str ?? '') + (item.hasEOL === true ? '\n' : '')).join('')
      page.cleanup()
      pages.push(text.trim())
      size += Buffer.byteLength(text)
    }
    if (pages.every(page => page === '')) {
      return { status: 'no-text-layer', format: 'pdf', text: '', truncated: false, units: pdf.numPages }
    }
    const text = pages.map((page, index) => `--- Page ${index + 1} ---\n${page}`).join('\n\n')
    return textResult(limits, 'pdf', text, pdf.numPages, pages.length < pdf.numPages)
  } finally {
    await pdf.loadingTask.destroy()
  }
}

/** Plain text when the prefix has no NUL byte and decodes as UTF-8. */
function plainText(limits: FileTextLimits, bytes: Uint8Array, complete: boolean): FileAttachmentText | undefined {
  const sample = bytes.subarray(0, 8192)
  if (sample.includes(0)) return undefined
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: false })
  try {
    decoder.decode(sample, { stream: true })
  } catch {
    return undefined
  }
  const text = new TextDecoder('utf-8').decode(bytes.subarray(0, limits.maxTextBytes + 4))
  return textResult(limits, 'text', text, undefined, !complete || bytes.byteLength > limits.maxTextBytes + 4)
}

/**
 * Extract model-readable text from one file's bytes, sniffing the format from
 * content rather than the name.
 * @param bytes - the file, or its first `limits.maxSourceBytes` bytes.
 * @param limits - text and source byte caps.
 * @param complete - whether `bytes` is the whole file.
 * @param signal - optional cancellation between PDF pages.
 * @returns the extraction outcome; never throws for malformed documents.
 */
export async function extractFileText(
  bytes: Uint8Array,
  limits: FileTextLimits,
  complete = true,
  signal?: AbortSignal,
): Promise<FileAttachmentText> {
  const tooLarge: FileAttachmentText = {
    status: 'unsupported', text: '', truncated: false,
    reason: `larger than ${Math.floor(limits.maxSourceBytes / 1024 / 1024)} MB`,
  }
  let format: FileTextFormat | undefined
  try {
    if (startsWith(bytes, PDF_MAGIC)) {
      format = 'pdf'
      return complete ? await pdfText(limits, bytes, signal) : { ...tooLarge, format }
    }
    if (startsWith(bytes, OLE_MAGIC)) {
      return { status: 'unsupported', text: '', truncated: false, reason: 'legacy binary Office file; save it as .docx, .xlsx, or .pptx' }
    }
    if (startsWith(bytes, ZIP_MAGIC)) {
      if (!complete) return tooLarge
      const names = new Set<string>()
      unzipSync(bytes, { filter: (file) => { names.add(file.name); return false } })
      if (names.has('word/document.xml')) {
        format = 'docx'
        return docxText(limits, bytes)
      }
      if (names.has('ppt/presentation.xml') || [...names].some(name => name.startsWith('ppt/slides/'))) {
        format = 'pptx'
        return pptxText(limits, bytes)
      }
      if (names.has('xl/workbook.xml')) {
        format = 'spreadsheet'
        return spreadsheetText(limits, bytes)
      }
      return { status: 'unsupported', text: '', truncated: false, reason: 'ZIP archive that is not a .docx, .xlsx, or .pptx file' }
    }
    return plainText(limits, bytes, complete)
      ?? { status: 'unsupported', text: '', truncated: false, reason: 'binary file type without a text reader' }
  } catch (error) {
    signal?.throwIfAborted()
    return {
      status: 'failed',
      ...format === undefined ? {} : { format },
      text: '',
      truncated: false,
      reason: (error instanceof Error ? error.message : String(error)).slice(0, 200),
    }
  }
}

/**
 * Sidecar path for one file's extracted text, beside the content-addressed objects.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param ref - durable file reference.
 * @param limits - caps the cached text was derived under.
 * @returns absolute JSON sidecar path.
 */
export function fileTextPath(root: string, ref: FileAttachmentRef, limits: FileTextLimits): string {
  const sha256 = String(ref.attachmentId).slice('sha256:'.length)
  return join(root, 'file-text', sha256.slice(0, 2),
    `${sha256}.v${FILE_TEXT_VERSION}-${limits.maxTextBytes}-${limits.maxSourceBytes}.json`)
}

async function readSourcePrefix(
  root: string, ref: FileAttachmentRef, limits: FileTextLimits,
): Promise<{ bytes: Uint8Array; complete: boolean }> {
  const chunks: Uint8Array[] = []
  let size = 0
  for await (const chunk of readFileStreamVerbatim(root, ref)) {
    chunks.push(chunk)
    size += chunk.byteLength
    if (size > limits.maxSourceBytes) return { bytes: new Uint8Array(Buffer.concat(chunks)), complete: false }
  }
  return { bytes: new Uint8Array(Buffer.concat(chunks)), complete: true }
}

/**
 * Read the cached text of one stored file, extracting and caching it on first use.
 * @param root - absolute `DSH_HOME/attachments/v1` root.
 * @param ref - durable file reference.
 * @param limits - text and source byte caps.
 * @returns the extraction outcome; storage failures become `failed`.
 */
export async function readOrExtractFileText(
  root: string, ref: FileAttachmentRef, limits: FileTextLimits,
): Promise<FileAttachmentText> {
  const path = fileTextPath(root, ref, limits)
  try {
    return JSON.parse(await readFile(path, 'utf8')) as FileAttachmentText
  } catch {
    // Missing or unreadable cache: derive it again below.
  }
  let result: FileAttachmentText
  try {
    const source = await readSourcePrefix(root, ref, limits)
    result = await extractFileText(source.bytes, limits, source.complete)
  } catch (error) {
    return { status: 'failed', text: '', truncated: false, reason: (error instanceof Error ? error.message : String(error)).slice(0, 200) }
  }
  const staged = `${path}.${randomUUID()}.tmp`
  try {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(staged, JSON.stringify(result))
    await rename(staged, path)
  } catch {
    await rm(staged, { force: true })
  }
  return result
}
