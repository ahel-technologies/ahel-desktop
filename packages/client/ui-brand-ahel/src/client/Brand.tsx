import { AhelTile, BrandWordmark } from '@deepseek-ai/dsh-client-ui-primitives'
import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SidebarBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-sidebar/client'

/**
 * Render the Ahel tile at the edge requested by the sidebar.
 * @param props - Host-supplied mark presentation.
 * @returns the logo tile.
 */
export function AhelBrandMark({ size }: SidebarBrandMarkOwnerProps) {
  return <AhelTile size={size} />
}

/**
 * Render the lowercase "ahel" wordmark without its independently slotted tile.
 * @returns the wordmark in the sidebar's text ink.
 */
export function AhelBrandName() {
  return <BrandWordmark includeMark={false} />
}

/**
 * Render the Ahel tile beside the blank-session headline.
 * @param props - Host-supplied edge and placement class.
 * @returns the logo tile.
 */
export function AhelHeroMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <AhelTile size={size} className={className} />
}
