/** The Knowledge product sheet: tile, price, promise, what is inside, an example ask, the product button and every source as a row. */
import { useState } from 'react'
import {
  Button, IconCheckOutlineRegular, IconCloseOutlineRegular, IconCopyOutlineRegular, Modal, Tag, writeClipboard,
} from '@ahel/dsh-client-ui-primitives'
import type { CatalogInstalled, KnowledgeProduct } from '@ahel/dsh-ahel-account/types'
import type { CatalogFaceProps } from './contract.ts'
import { AppRow } from './AppRow.tsx'
import { KnowledgeTile } from './KnowledgeTile.tsx'
import { formatPrice, KNOWLEDGE_URL, sourceRow, useProductButton } from './knowledgeAction.ts'
import drawerCss from './DetailDrawer.module.css'
import css from './Knowledge.module.css'

/** How long the copy button shows its check after a copy. */
const COPIED_MS = 1_000

/** Props of the product sheet. */
export type KnowledgeDrawerProps = Pick<CatalogFaceProps, 'install' | 'setEnabled' | 'signIn' | 'openLink' | 't'> & {
  readonly product: KnowledgeProduct
  /** Source ids the search words found; they are listed first. Null while browsing. */
  readonly matches: readonly string[] | null
  readonly installed: CatalogInstalled | null
  readonly signedIn: boolean
  readonly onClose: () => void
}

/**
 * Render the product sheet. Key it by the product id so a new product starts fresh.
 * @param props - the product, the person's installs and the catalog actions.
 * @returns the right-side sheet.
 */
export function KnowledgeDrawer(props: KnowledgeDrawerProps) {
  const { product, matches, installed, signedIn, onClose, install, setEnabled, signIn, openLink, t } = props
  const button = useProductButton(product, props)
  const [copied, setCopied] = useState(false)
  const found = new Set(matches ?? [])
  const sources = [...product.sources].sort((a, b) => Number(found.has(b.id)) - Number(found.has(a.id)))

  const copy = (): void => {
    void writeClipboard(product.ask).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, COPIED_MS)
    })
  }

  return (
    <Modal open headless title={product.name} onClose={onClose} className={drawerCss.sheet ?? ''}>
      <div className={drawerCss.bar}>
        <button type="button" className={drawerCss.close} aria-label={t('close')} onClick={onClose}>
          <IconCloseOutlineRegular size={16} />
        </button>
      </div>
      <div className={drawerCss.body}>
        <div className={drawerCss.hero}>
          <KnowledgeTile glyph={product.glyph} size={56} />
          <div className={drawerCss.heroText}>
            <h2 className={drawerCss.name}>{product.name}</h2>
            <span className={drawerCss.tags}>
              <Tag tone="success">{formatPrice(product.cents)}</Tag>
              <Tag tone="outline">{t('knowledgeSources', { count: product.sources.length })}</Tag>
            </span>
          </div>
        </div>
        <p className={drawerCss.description}>{product.promise}</p>
        <p className={css.inside}><span className={css.insideLabel}>{t('knowledgeInside')}</span>{product.includes}</p>
        <div className={drawerCss.outcome}>
          <span className={drawerCss.outcomeText}>{t('knowledgeAsk', { prompt: product.ask })}</span>
          <button type="button" className={drawerCss.copy} aria-label={t('knowledgeCopyAsk')} onClick={copy}>
            {copied ? <IconCheckOutlineRegular size={14} /> : <IconCopyOutlineRegular size={14} />}
          </button>
        </div>
        <div className={drawerCss.actions}>
          <Button variant="primary" disabled={button.disabled} onClick={button.press} data-modal-autofocus>{button.label}</Button>
          <Button variant="outline" onClick={() => { openLink(KNOWLEDGE_URL) }}>{t('openOnAhel')}</Button>
        </div>
        {button.outcome !== null && (
          <p className={button.outcome.error ? `${drawerCss.outcome} ${drawerCss.outcomeError}` : drawerCss.outcome} role="status">
            {button.outcome.text}
          </p>
        )}
        <p className={css.footnote}>{t('knowledgeFootnote')}</p>
        <section className={drawerCss.nest} aria-labelledby="ahel-knowledge-sources">
          <h3 id="ahel-knowledge-sources" className={drawerCss.nestTitle}>{t('knowledgeSources', { count: sources.length })}</h3>
          <ul className={drawerCss.nestList}>
            {sources.map(source => (
              <AppRow key={source.id} row={sourceRow(source)} bare installed={installed} signedIn={signedIn}
                install={install} setEnabled={setEnabled} signIn={signIn} openLink={openLink} t={t} />
            ))}
          </ul>
        </section>
      </div>
    </Modal>
  )
}
