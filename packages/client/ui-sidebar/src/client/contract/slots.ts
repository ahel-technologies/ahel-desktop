/**
 * Sidebar slot contract: the registrant-side props composition for the
 * layout-owned `sidebar` slot, plus the holes this shell declares. The shell
 * owns column geometry, the brand row, New Session, and global panel rows;
 * everything between the workspace section header and the list bottom is the
 * `sidebar.workspaces` registrant's (ui-workspace), and the foot is the
 * `sidebar.settings` registrant's (ui-settings), followed by optional footer
 * actions in `sidebar.footer.action`. `sidebar.header` entries sit under the
 * brand row.
 */
import type { ReactNode } from 'react'
import type { InjectFace, PropsLocale, PropsRenderSlots, PropsRuntime } from '@ahel/dsh-client-ui-slots'
import type { ObservableSnapshot } from '@ahel/dsh-client-store'
import type { WorkspaceId } from '@ahel/dsh-api-workspace-controller/client'
import type { ShortcutCatalogEntry } from '@ahel/dsh-client-shortcuts/client'
import type { MainPanelId } from '@ahel/dsh-client-ui-layout/client'

declare module '@ahel/dsh-client-ui-slots' {
  interface SlotMap {
    /** Non-interactive notification inside the collapsed sidebar expand button. */
    'sidebar.toggle.badge': { kind: 'single'; scope: 'root'; owner: Record<never, never> }
    /**
     * Brand mark rendered in the expanded brand row and collapsed rail.
     * Declared by this package's `sidebar` entry; deployments may replace
     * the shell's Ahel tile fallback without replacing the surrounding controls.
     */
    'sidebar.brand.mark': { kind: 'single'; scope: 'root'; owner: SidebarBrandMarkOwnerProps }
    /**
     * Brand name rendered beside the expanded mark. Declared by this
     * package's `sidebar` entry; the shell supplies a generic text fallback.
     */
    'sidebar.brand.name': { kind: 'single'; scope: 'root'; owner: SidebarBrandNameOwnerProps }
    /**
     * The press around the expanded brand mark and name. Declared by this
     * package's `sidebar` entry; without an occupant the brand starts a New
     * Session. An occupant renders its own element (for example a link to the
     * deployment's home page) around the shell's identity. The macOS desktop
     * brand stays a window-drag surface and never renders this slot.
     */
    'sidebar.brand.link': { kind: 'single'; scope: 'root'; owner: SidebarBrandLinkOwnerProps }
    /**
     * Global panel icons. Each list id addresses the matching main panel;
     * the sidebar owns the button and resolves its label from list metadata.
     */
    'sidebar.panellist': { kind: 'list'; scope: 'root'; owner: SidebarPanelIconOwnerProps }
    /**
     * The workspace/session browsing region: section header, search, the
     * grouped/flat session list, and every workspace dialog. Declared by this
     * package's 'sidebar' entry (declaring is claiming); ui-workspace
     * registers the browser.
     */
    'sidebar.workspaces': { kind: 'single'; scope: 'root'; owner: SidebarSectionOwnerProps }
    /**
     * The settings seat at the sidebar foot. Declared by this package's
     * 'sidebar' entry; ui-settings registers its trigger row + modal panel.
     * The sidebar passes only its column state — it holds no settings state.
     */
    'sidebar.settings': { kind: 'single'; scope: 'root'; owner: SidebarSettingsOwnerProps }
    /**
     * Optional actions beside Settings at the sidebar foot. Declared by this
     * package's 'sidebar' entry; each action receives only the column state.
     */
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: SidebarFooterActionOwnerProps }
    /**
     * Entries at the top of the column, under the brand row and above New
     * Session and the panel rows, for example the signed-in team's name and
     * members. Declared by this package's 'sidebar' entry; each entry
     * receives the column state and renders nothing it has no room for.
     */
    'sidebar.header': { kind: 'list'; scope: 'root'; owner: SidebarHeaderOwnerProps }
    /**
     * The column under the brand row. Declared by this package's 'sidebar'
     * entry; without an occupant the shell renders its own header entries,
     * New Session, panel rows, browsing region and foot. An occupant replaces
     * all of them, for example a deployment's fixed navigation rail, and
     * places whichever of the shell's parts it keeps through the render
     * functions it receives, including outside the column through a portal.
     */
    'sidebar.body': { kind: 'single'; scope: 'root'; owner: SidebarBodyOwnerProps }
  }
}

/** Geometry supplied to the sidebar brand-mark occupant. */
export interface SidebarBrandMarkOwnerProps {
  /** Requested square edge in pixels. */
  size: number
}

/** Empty owner share for the sidebar brand-name occupant. */
export interface SidebarBrandNameOwnerProps {
  /** Marker field: the occupant owns its own content and width. */
  children?: never
}

/** Owner share of the brand press occupant. */
export interface SidebarBrandLinkOwnerProps {
  /** The shell's brand-row class; the occupant puts it on its own element. */
  className: string
  /** The shell's mark and name, which the occupant renders inside its element. */
  identity: ReactNode
}

/** Icon presentation supplied by the global panel row. */
export interface SidebarPanelIconOwnerProps {
  /** Requested square edge in pixels. */
  size: number
  /** Whether this panel is selected in the main column. */
  active: boolean
  /** Whether the row is the wide column's (glyph and title); false or absent is the collapsed rail's glyph alone. */
  wide?: boolean
}

/** Serializable metadata for one active global panel list registration. */
export interface SidebarPanelMetadata {
  /** List id and matching main panel key. */
  id: MainPanelId
  /** Ascending row order; ties retain registration order. */
  order: number
  /** Row title and accessible name: resolved label, or the id when omitted. */
  label: string
}

/**
 * Owner share of the browser hole — the only facts crossing the shell/region
 * boundary. Business data and actions arrive through the region's own inject.
 */
export interface SidebarSectionOwnerProps {
  /** Shell fold-state output: wide renders the full browser, rail the icon column. */
  wide: boolean
  /** Rail icons request expansion; the browser rides the wide flip for focus. */
  expandSidebar: () => void
}

/**
 * Owner share of the sidebar settings seat: the column display state the
 * occupant's trigger row must render against (wide row vs rail icon).
 */
export interface SidebarSettingsOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/** Owner share of one entry at the top of the column. */
export interface SidebarHeaderOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/** Owner share of the column body occupant: the column state and the shell's own parts. */
export interface SidebarBodyOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
  /** Expand a collapsed column; does nothing while it is open. */
  expandSidebar: () => void
  /** Start a New Session, as the shell's own New Session button does. */
  startSession: () => void
  /** @returns the `sidebar.header` entries at the column's current width. */
  renderHeader: () => ReactNode
  /** @returns the `sidebar.workspaces` browsing region at full width, for a column of its own. */
  renderWorkspaces: () => ReactNode
  /** @returns the `sidebar.footer.action` entries at the column's current width. */
  renderFooterActions: () => ReactNode
  /** @returns the `sidebar.settings` seat at the column's current width. */
  renderSettings: () => ReactNode
}

/** Owner share of an action rendered beside Settings at the sidebar foot. */
export interface SidebarFooterActionOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/**
 * Registrant-private injected share (arrives via the register inject
 * factory). The renderer binds the panel metadata source to usePanels.
 */
export type SidebarRootInjected = {
  /**
   * Start a New Session: with a workspace, reuse-or-create its blank session
   * and open it; without one, inherit the current Session Workspace, then the
   * recent Workspace, or clear into the New Session pure view when none exist.
   */
  startSession: (workspaceId?: WorkspaceId) => void
  /** Toggle the sidebar column through the layout service. */
  toggleSidebar: () => void
  /** Select the global panel addressed by a sidebar row. */
  selectPanel: (id: MainPanelId) => void
  /** Private reactive sources bound to framework selector hooks. */
  hooks: { panels: ObservableSnapshot<readonly SidebarPanelMetadata[]>; shortcuts: ObservableSnapshot<readonly ShortcutCatalogEntry[]> }
}

/**
 * Full component props: layout owner state/actions plus the declared holes'
 * render shares, this package's injected callbacks, and the standard locale
 * seat. Panel metadata arrives through an injected observable.
 */
export type SidebarRootComponentProps =
  PropsRuntime<'sidebar'>
  & PropsRenderSlots<
    | 'sidebar.brand.mark'
    | 'sidebar.brand.name'
    | 'sidebar.brand.link'
    | 'sidebar.toggle.badge'
    | 'sidebar.panellist'
    | 'sidebar.workspaces'
    | 'sidebar.settings'
    | 'sidebar.footer.action'
    | 'sidebar.header'
    | 'sidebar.body'
  >
  & InjectFace<SidebarRootInjected> & PropsLocale<'sidebar'>
