/**
 * The one-key provider tiles on the Models page. Each tile names a preset
 * provider not yet configured; choosing one opens a card with a key field and
 * a link to the provider's key page, and Connect writes the preset profile and
 * the key (see ./presets.ts).
 */

import { useState } from 'react'
import type { ReactNode } from 'react'
import { apiKeyFailure } from './apiKey.ts'
import { EditorFooter } from './EditorFooter.tsx'
import { connectPreset, keyHost, PROVIDER_PRESETS } from './presets.ts'
import type { ProviderPreset } from './presets.ts'
import type { ModelsOperations } from './operations.ts'
import type { en } from './locales.ts'
import styles from './ModelsSection.module.css'

/** Props of {@link PresetTiles}. */
export interface PresetTilesProps {
  /** Route ids already configured; their tiles are not offered. */
  configured: readonly string[]
  /** Revision of the `llm-pi-ai` user section, or undefined when the namespace is not mounted. */
  revision: number | undefined
  /** The route whose card is open, or undefined. */
  open: string | undefined
  /** Open one preset's card, or close it with undefined. */
  onOpen: (route: string | undefined) => void
  /** Called after a preset connected, with the route. */
  onConnected: (preset: ProviderPreset) => void
  /** The Host operations the card writes through. */
  operations: ModelsOperations
  /** Section copy. */
  t: (key: keyof typeof en) => string
  /** Disable writes (read-only settings provider). */
  readOnly: boolean
}

/**
 * Render the preset tiles and the open preset's card.
 * @param props - configured routes, the open card, wire faces, and copy.
 * @returns the tiles, or null when every preset is configured or pi-ai is not mounted.
 */
export function PresetTiles(props: PresetTilesProps): ReactNode {
  const { configured, revision, open, onOpen, t } = props
  if (revision === undefined) return null
  const offered = PROVIDER_PRESETS.filter(preset => !configured.includes(preset.route))
  if (offered.length === 0) return null
  const openPreset = offered.find(preset => preset.route === open)
  return (
    <div className={styles['presets']}>
      <span className={styles['fieldLabel']}>{t('presetsHeading')}</span>
      <div className={styles['presetGrid']}>
        {offered.map(preset => (
          <button
            key={preset.route}
            type="button"
            className={`${styles['presetTile']} ${preset.route === open ? styles['presetTileOpen'] : ''}`}
            aria-expanded={preset.route === open}
            disabled={props.readOnly}
            onClick={() => { onOpen(preset.route === open ? undefined : preset.route) }}
          >
            <span className={styles['presetGlyph']} aria-hidden="true">{preset.glyph}</span>
            <span className={styles['presetText']}>
              <span className={styles['rowName']}>{preset.displayName}</span>
              <span className={styles['presetBlurb']}>{t(preset.blurbKey)}</span>
            </span>
          </button>
        ))}
      </div>
      {openPreset === undefined
        ? null
        : (
          <PresetCard
            key={openPreset.route}
            preset={openPreset}
            revision={revision}
            operations={props.operations}
            t={t}
            readOnly={props.readOnly}
            onClose={() => { onOpen(undefined) }}
            onConnected={props.onConnected}
          />
        )}
    </div>
  )
}

interface PresetCardProps {
  preset: ProviderPreset
  revision: number
  operations: ModelsOperations
  t: (key: keyof typeof en) => string
  readOnly: boolean
  onClose: () => void
  onConnected: (preset: ProviderPreset) => void
}

function PresetCard({ preset, revision, operations, t, readOnly, onClose, onConnected }: PresetCardProps): ReactNode {
  const [openedAt] = useState(revision)
  const [keyDraft, setKeyDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>(undefined)
  const keyFailure = apiKeyFailure(keyDraft)
  const key = keyDraft.trim()

  const connect = async (): Promise<void> => {
    setBusy(true)
    setFailure(undefined)
    try {
      const outcome = await connectPreset(preset, key, operations, openedAt, t('presetNoModels'))
      if (outcome !== undefined) {
        setFailure(outcome)
        return
      }
      onConnected(preset)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles['editor']}>
      <div className={styles['field']}>
        <span className={styles['fieldLabel']}>{`${preset.displayName} ${t('keyInput')}`}</span>
        <input
          className={styles['input']}
          type="password"
          autoComplete="new-password"
          value={keyDraft}
          placeholder={t('keyPlaceholder')}
          aria-label={`${preset.displayName} ${t('keyInput')}`}
          disabled={readOnly || busy}
          onChange={(event) => { setKeyDraft(event.target.value) }}
        />
        {keyFailure === undefined ? null : <p className={styles['error']}>{t(keyFailure)}</p>}
      </div>
      <a className={styles['presetLink']} href={preset.keyUrl} target="_blank" rel="noopener noreferrer">
        {t('presetGetKey').replace('{host}', keyHost(preset))}
      </a>
      {failure === undefined ? null : <p role="alert" className={styles['error']}>{failure}</p>}
      <EditorFooter
        t={t}
        busy={busy}
        submitDisabled={readOnly || busy || key.length === 0 || keyFailure !== undefined}
        submitLabelKey="presetConnect"
        submitBusyLabelKey="presetConnecting"
        onCancel={onClose}
        onSubmit={() => { void connect() }}
      />
    </div>
  )
}
