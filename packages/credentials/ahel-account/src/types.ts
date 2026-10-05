/** Client-safe Ahel account state; no token, verifier or code crosses this projection. */
import type {} from '@ahel/cordis'
import type { Branded } from '@ahel/dsh-brand'

/** Identity of one local sign-in attempt. */
export type AhelSignInAttemptId = Branded<'AhelSignInAttemptId'>

/**
 * Safe failure codes rendered through the caller's locale dictionary.
 * `denied`: declined in the browser or refused by ahel.ai; `timeout`: no browser callback in time;
 * `network`: ahel.ai unreachable or answered an error; `protocol`: an unexpected response or callback;
 * `storage`: the credential could not be written; `cancelled`: the attempt was cancelled locally.
 */
export type AhelSignInErrorCode = 'denied' | 'timeout' | 'network' | 'protocol' | 'storage' | 'cancelled'

/** Latest sign-in attempt, including its terminal outcome until the next attempt. */
export interface AhelSignInAttemptView {
  readonly id: AhelSignInAttemptId
  readonly phase: 'starting' | 'waiting-browser' | 'exchanging' | 'succeeded' | 'cancelled' | 'failed'
  /** The ahel.ai authorize URL; present from `waiting-browser` on. Safe to show: it carries no secret. */
  readonly authorizeUrl?: string
  readonly errorCode?: AhelSignInErrorCode
}

/** One workspace membership of the signed-in person. */
export interface AhelWorkspace {
  readonly id: string
  readonly name: string
  readonly slug: string
  readonly role: string
}

/** Display identity from `GET /api/mcp/profile`. */
export interface AhelProfile {
  readonly email: string
  readonly name: string | null
  readonly workspaces: readonly AhelWorkspace[]
}

/** Stored-account presence plus the latest attempt; presence is not a claim that ahel.ai still accepts the grant. */
export interface AhelAccountView {
  readonly status: 'signed-out' | 'signed-in'
  /** Profile captured at sign-in; null while signed out. */
  readonly profile: AhelProfile | null
  readonly attempt: AhelSignInAttemptView | null
  /** Selected workspace id (one of `profile.workspaces`); null leaves the choice to ahel.ai. */
  readonly workspace: string | null
  /** Whether ahel.ai answered the latest reachability read. */
  readonly reachable: boolean
}

/** One Discover listing query, as ahel.ai/discover reads it. */
export interface CatalogBrowseQuery {
  /** Search words; "" browses. */
  readonly q: string
  readonly kind: 'all' | 'app' | 'skill'
  /** One of ahel.ai's Discover category keys, or null for every category. */
  readonly category: string | null
  /** Zero-based page of `pageSize` groups. */
  readonly page: number
}

/** One part of a row's fact line, in display order; mirrors ahel's `FactPart`. */
export type CatalogFactPart =
  | { readonly key: 'provenance'; readonly text: 'Official' | 'Community'; readonly official: boolean }
  | { readonly key: 'by'; readonly text: string }
  | { readonly key: 'runs'; readonly text: string }
  | { readonly key: 'tools'; readonly text: string; readonly reads: number; readonly writes: number }
  | { readonly key: 'connect'; readonly text: string; readonly need: 'sign-in' | 'key' | 'none' }
  | { readonly key: 'price'; readonly text: string; readonly source: 'ahel' | 'vendor' }

/** The row's state control as ahel.ai computes it for a signed-out reader; mirrors `DiscoverRowState`. */
export type CatalogRowState = 'connect' | 'add' | 'added' | 'on' | 'needs-setup' | 'install' | 'turn-on' | 'unavailable'

/** The row's tile; mirrors `DiscoverRowTile`. */
export interface CatalogRowTile {
  /** One or two letters. */
  readonly text: string
  readonly tone: 'plain' | 'skill' | 'ahel'
  /** Absolute https URL of a vendor mark on ahel.ai, or null. */
  readonly mark: string | null
}

/** One listing row; mirrors ahel's `DiscoverRowData` with `href` and `tile.mark` made absolute. */
export interface CatalogRow {
  /** The catalog id, or "app:<service>" for an Actions app. */
  readonly id: string
  readonly name: string
  readonly kind: 'app' | 'skill'
  readonly kindLabel: 'App' | 'Skill'
  readonly tile: CatalogRowTile
  readonly facts: readonly CatalogFactPart[]
  readonly chips: readonly string[]
  readonly description: string | null
  /** Absolute https URL of the item's public page on ahel.ai. */
  readonly href: string
  readonly state: CatalogRowState
  readonly vendor: { readonly slug: string; readonly name: string } | null
  readonly official: boolean
}

/** One listing group: a vendor's or a product's head row, its nested skills and folded copies. */
export interface CatalogGroup {
  /** Stable for the same query; `browsePart` fetches more of the nest by it. */
  readonly key: string
  readonly row: CatalogRow
  readonly skills: { readonly vendorName: string; readonly count: number; readonly rows: readonly CatalogRow[] } | null
  /** Community copies folded under this row; 0 for none. */
  readonly copies: number
}

/** One page of the Discover listing. */
export interface CatalogBrowsePage {
  readonly total: number
  readonly page: number
  readonly pageSize: number
  readonly groups: readonly CatalogGroup[]
  /** Rows per kind under the other filters. */
  readonly kinds: { readonly app: number; readonly skill: number }
  /** Records per category key under the other filters; a category with none is absent. */
  readonly categories: Readonly<Record<string, number>>
}

/** A further slice of one group's nested skills. */
export interface CatalogPart {
  readonly rows: readonly CatalogRow[]
  /** Rows still held back after this slice. */
  readonly remaining: number
}

/** One capability in the signed-in person's ahel.ai workspace, from the MCP `installed` tool. */
export interface CatalogCapability {
  readonly key: string
  readonly name: string
  readonly type: string | null
  readonly servedBy?: string
  readonly state: 'on' | 'off' | 'needs_setup' | 'unavailable' | 'available'
  readonly needs: readonly string[]
  readonly missingTypes?: readonly string[]
  /** Catalog id the capability was installed from; matches `CatalogRow.id`. */
  readonly itemId?: string | null
  /** For a `needs_setup` app row: the ahel.ai page that finishes its sign-in. */
  readonly signInUrl?: string
  readonly reason: string | null
}

/** What the signed-in person has installed; empty while signed out. */
export interface CatalogInstalled {
  readonly signedIn: boolean
  readonly rows: readonly CatalogCapability[]
}

/** The MCP `install` answer. `needs_setup` comes with a sign-in or key URL to open in the browser. */
export interface CatalogInstallResult {
  readonly key: string | null
  readonly name: string
  readonly type: string
  readonly state: string
  readonly needs: readonly string[]
  readonly signInUrl?: string
  readonly connectUrl?: string
  readonly note: string
  /** A first thing to ask the model, or null. */
  readonly try: string | null
}

/** The MCP `switch` answer: the stored state after the write. */
export interface CatalogSwitchResult {
  readonly key: string
  readonly state: string
}

/** One Knowledge source: a dataset row of ahel.ai's catalog (`kind: dataset`). */
export interface KnowledgeSource {
  /** The catalog id, such as `ahel.datasets/companies-ee`; `add` takes it. */
  readonly id: string
  readonly name: string
  readonly description: string
  /** Whether ahel.ai can serve it today; an unservable source has no Add. */
  readonly servable: boolean
  /** Absolute https URL of its ahel.ai page. */
  readonly href: string
}

/** One Knowledge product as ahel.ai/knowledge sells it: a job, one price per query, its sources. */
export interface KnowledgeProduct {
  readonly id: string
  readonly name: string
  /** Whole cents per query, paid from the workspace balance. */
  readonly cents: number
  /** The one line under the name. */
  readonly promise: string
  readonly includes: string
  /** An example question to ask once it is added. */
  readonly ask: string
  /** ahel.ai's glyph name: `building`, `shield-alert`, `gavel` or `bug`. */
  readonly glyph: string
  readonly sources: readonly KnowledgeSource[]
}

/** The Knowledge listing; with search words, `matches` holds the ids of the sources they found. */
export interface KnowledgeListing {
  readonly products: readonly KnowledgeProduct[]
  /** Null when browsing without search words. */
  readonly matches: readonly string[] | null
}

declare module '@ahel/cordis' {
  interface Events {
    /**
     * The account view changed: a sign-in step, a completed sign-in or sign-out, or an external edit of the stored grant.
     * @param view - the new complete view.
     * @mode emit
     */
    'ahel-account/changed'(view: AhelAccountView): void
  }
}
