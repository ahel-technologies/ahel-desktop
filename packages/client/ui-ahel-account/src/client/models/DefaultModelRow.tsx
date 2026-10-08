/**
 * The top row of Settings > Models: the workspace's default metered model,
 * where new chats start in ahel chat and Ahel Desktop. The owner or a team
 * lead picks it from the metered models grouped by maker; everyone else sees
 * it read-only. Signed out, or before ahel.ai knows the setting, it renders nothing.
 */
import { useState } from 'react'
import { IconChevronDownOutlineRegular, Menu } from '@ahel/dsh-client-ui-primitives'
import type { MenuEntry } from '@ahel/dsh-client-ui-primitives'
import type { HostObservable, InjectFace, PropsLocale, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type {} from '@ahel/dsh-client-ui-settings-models/client'
import type { AhelMeteredModel } from '@ahel/dsh-ahel-account/types'
import type { DefaultModelView } from './source.ts'
import css from '../AhelAccount.module.css'

/** Face of the Default model row. */

/**
 * A readable name for a model id the Ahel route no longer lists: the id's last
 * segment in words, never the raw id ("anthropic/claude-haiku-4.5" → "Claude Haiku 4.5").
 * Local on purpose: client plugins import no values from other plugins.
 * @param id - OpenRouter-style model id.
 * @returns the readable name.
 */
function unlistedModelName(id: string): string {
  const slug = (id.split('/').at(-1) ?? id).split(':')[0] ?? id
  return slug.split('-').filter(word => word !== '')
    .map(word => /^gpt$/i.test(word) ? 'GPT' : word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

export interface DefaultModelInjected {
  /**
   * Store the workspace default.
   * @param model - a metered model id, or null to clear it.
   */
  setDefault(model: string | null): Promise<void>
  hooks: {
    models: HostObservable<DefaultModelView>
  }
}

/** Props of the Default model row. */
export type DefaultModelRowProps = PropsRuntime<'settings.models.header'> & InjectFace<DefaultModelInjected> & PropsLocale<'ahel-account'>

/** ahel.ai's name without its "Maker: " prefix, when it sends no short name. */
function shortName(model: AhelMeteredModel): string {
  return model.ahel?.shortName ?? model.name.replace(/^[^:]+:\s*/, '')
}

/** ahel.ai's maker, else the "Maker: " prefix of its name, else the id's routing prefix. */
function makerOf(model: AhelMeteredModel): string {
  const prefix = /^([^:]+):/.exec(model.name)?.[1]
  return model.ahel?.maker ?? prefix ?? model.id.split('/')[0] ?? model.id
}

/** A per-message price: `3.3¢`, or `<0.1¢` below a tenth of a cent. */
function priceText(cents: number): string {
  return cents > 0 && cents < 0.1 ? '<0.1¢' : `${String(Math.round(cents * 10) / 10)}¢`
}

/**
 * Render the Default model row.
 * @param props - composed slot props.
 * @returns the row, or nothing signed out or while the setting is unknown.
 */
export function DefaultModelRow({ setDefault, useModels, t }: DefaultModelRowProps) {
  const view = useModels(value => value)
  const [open, setOpen] = useState(false)
  if (!view.signedIn || view.defaultModel === undefined || view.models.length === 0) return null
  const chosen = view.models.find(model => model.id === view.defaultModel)
  // A default ahel.ai no longer lists keeps its name, marked, instead of reading as not set.
  const label = chosen !== undefined
    ? shortName(chosen)
    : view.defaultModel === null ? t('defaultModelNone') : t('defaultModelUnlisted', { name: unlistedModelName(view.defaultModel) })
  const price = chosen?.ahel?.typicalMessageCents ?? null
  const items: MenuEntry[] = []
  for (const maker of [...new Set(view.models.map(makerOf))]) {
    items.push({ type: 'label', id: `maker:${maker}`, text: maker })
    for (const model of view.models.filter(candidate => makerOf(candidate) === maker)) {
      const typical = model.ahel?.typicalMessageCents ?? null
      items.push({
        id: model.id,
        label: <span className={css.defaultOption}>{shortName(model)}{typical === null ? null : <small>{priceText(typical)}</small>}</span>,
      })
    }
  }
  const locked = !view.canSet || view.saving
  return (
    <div className={css.defaultRow}>
      <div className={css.rowText}>
        <div className={css.rowTitle}>{t('defaultModelTitle')}</div>
        <div className={css.caption}>{t('defaultModelCaption')}</div>
        {view.error === null ? null : <div className={css.defaultError} role="alert">{t('defaultModelFailed', { message: view.error })}</div>}
      </div>
      <div className={css.defaultPick}>
        <Menu
          open={open && !locked}
          portal
          align="end"
          items={items}
          selectedId={view.defaultModel ?? undefined}
          onSelect={(id) => { setOpen(false); if (id !== view.defaultModel) void setDefault(id) }}
          onClose={() => { setOpen(false) }}
          anchor={(
            <button type="button" className={css.defaultSelect} aria-haspopup="menu" aria-expanded={open && !locked} disabled={locked}
              onClick={() => { setOpen(value => !value) }}>
              {label}
              {price === null ? null : <small>{priceText(price)}</small>}
              {view.canSet ? <IconChevronDownOutlineRegular size={14} /> : null}
            </button>
          )}
        />
        <div className={css.caption}>{view.canSet ? t('defaultModelBilled') : t('defaultModelOwnerOnly')}</div>
      </div>
    </div>
  )
}
