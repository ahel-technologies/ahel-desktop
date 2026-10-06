/** The Ahel tile inside the running-status pulse: the breathing clip on dark, the vector tile otherwise. */
import { useState } from 'react'
import { AhelTile } from '@ahel/dsh-client-ui-primitives'
import type { BrandPulseMarkOwnerProps } from '@ahel/dsh-client-ui-conversation/client'
import { BRAND_PULSE_WEBM } from './brand-pulse-webm.ts'
import css from './BrandPulseMark.module.css'

/** The clip draws the tile at about 70% of its frame; the rest is glow room. */
const CLIP_TO_TILE = 1.4

/**
 * Render the Ahel tile for the activity pulse. The dark theme plays the
 * breathing clip and stops the owner's CSS breathing; the light theme, reduced
 * motion, and a clip that cannot play keep the vector tile under that CSS breathing.
 * @param props - Host-supplied tile edge.
 * @returns the tile with its optional clip.
 */
export function BrandPulseMark({ size }: BrandPulseMarkOwnerProps) {
  const [failed, setFailed] = useState(false)
  const clip = Math.round(size * CLIP_TO_TILE)
  return (
    <span className={css.mark} data-ahel-pulse-mark="">
      {!failed && (
        <video className={css.clip} src={BRAND_PULSE_WEBM} width={clip} height={clip}
          autoPlay muted loop playsInline disablePictureInPicture preload="auto" aria-hidden="true"
          data-ahel-pulse-clip="" onError={() => { setFailed(true) }} />
      )}
      <AhelTile size={size} className={css.tile} />
    </span>
  )
}
