/**
 * A small Markdown reader for issue descriptions and comments: headings,
 * paragraphs, bullet and numbered lists, quotes, fenced code, inline code,
 * bold, italic and https links. It builds React elements only, so no
 * markup in the text ever reaches the page.
 */
import type { ReactNode } from 'react'
import css from './Issues.module.css'

/** Inline spans: `code`, **bold**, *italic* and [text](https://…). */
const INLINE = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*\s][^*]*\*|_[^_\s][^_]*_|\[[^\]]+\]\([^)\s]+\))/g

function inline(text: string, openLink: (url: string) => void, prefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let last = 0
  let n = 0
  for (const match of text.matchAll(INLINE)) {
    const token = match[0]
    const at = match.index
    if (at > last) out.push(text.slice(last, at))
    const key = `${prefix}-${n++}`
    if (token.startsWith('`')) out.push(<code key={key} className={css.mdCode}>{token.slice(1, -1)}</code>)
    else if (token.startsWith('**')) out.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    else if (token.startsWith('[')) {
      const split = token.indexOf('](')
      const label = token.slice(1, split)
      const href = token.slice(split + 2, -1)
      out.push(/^https?:\/\//.test(href)
        ? <a key={key} href={href} className={css.mdLink} onClick={(event) => { event.preventDefault(); openLink(href) }}>{label}</a>
        : label)
    } else out.push(<em key={key}>{token.slice(1, -1)}</em>)
    last = at + token.length
  }
  if (last < text.length) out.push(text.slice(last))
  return out
}

/**
 * Render Markdown text.
 * @param props - the text and the link opener.
 * @returns the blocks.
 */
export function Markdown({ text, openLink }: { text: string; openLink: (url: string) => void }) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let i = 0
  let n = 0
  while (i < lines.length) {
    const line = lines[i] as string
    const key = `b${n++}`
    if (line.trim() === '') { i++; continue }
    if (line.startsWith('```')) {
      const code: string[] = []
      i++
      while (i < lines.length && !(lines[i] as string).startsWith('```')) code.push(lines[i++] as string)
      i++
      blocks.push(<pre key={key} className={css.mdPre}><code>{code.join('\n')}</code></pre>)
      continue
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading !== null) {
      const level = (heading[1] as string).length
      const content = inline(heading[2] as string, openLink, key)
      blocks.push(level <= 2 ? <h3 key={key} className={css.mdH}>{content}</h3> : <h4 key={key} className={css.mdH}>{content}</h4>)
      i++
      continue
    }
    if (/^\s*([-*+]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]\s+/.test(line)
      const items: ReactNode[] = []
      while (i < lines.length && /^\s*([-*+]|\d+[.)])\s+/.test(lines[i] as string)) {
        const item = (lines[i] as string).replace(/^\s*([-*+]|\d+[.)])\s+/, '').replace(/^\[( |x)\]\s+/i, (box: string) => box.toLowerCase().includes('x') ? '☑ ' : '☐ ')
        items.push(<li key={`${key}-${items.length}`}>{inline(item, openLink, `${key}-${items.length}`)}</li>)
        i++
      }
      blocks.push(ordered ? <ol key={key} className={css.mdList}>{items}</ol> : <ul key={key} className={css.mdList}>{items}</ul>)
      continue
    }
    if (line.startsWith('>')) {
      const quote: string[] = []
      while (i < lines.length && (lines[i] as string).startsWith('>')) quote.push((lines[i++] as string).replace(/^>\s?/, ''))
      blocks.push(<blockquote key={key} className={css.mdQuote}>{inline(quote.join(' '), openLink, key)}</blockquote>)
      continue
    }
    const paragraph: string[] = []
    while (i < lines.length && (lines[i] as string).trim() !== '' && !/^(```|#{1,4}\s|>|\s*([-*+]|\d+[.)])\s+)/.test(lines[i] as string)) {
      paragraph.push(lines[i++] as string)
    }
    if (paragraph.length === 0) paragraph.push(lines[i++] as string)
    blocks.push(<p key={key} className={css.mdP}>{inline(paragraph.join(' '), openLink, key)}</p>)
  }
  return <div className={css.md}>{blocks}</div>
}
