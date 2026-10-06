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
  /**
   * Set when ahel.ai's hosted chat launched this Host with its grant; sign-in
   * and sign-out then happen on ahel.ai. Absent or null elsewhere.
   */
  readonly hosted?: AhelHostedPages | null
}

/** ahel.ai pages that own sign-in and sign-out for a Host launched by the hosted chat. */
export interface AhelHostedPages {
  /** Reloading this page gets a fresh grant from ahel.ai. */
  readonly signInUrl: string
  /** ahel.ai page with the Sign out button. */
  readonly signOutUrl: string
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
  /** One Discover section, as ahel.ai's section strip names it; absent or null lists everything. */
  readonly concept?: CatalogConcept | null
  /** The rail's Show checkboxes. */
  readonly official?: boolean
  readonly free?: boolean
  /** Absent: Best match with words, Most added without. */
  readonly sort?: CatalogSort
}

/** ahel.ai's Discover sections, by public slug, in its strip order (`CONCEPTS` in src/lib/catalog/concepts.ts). */
export type CatalogConcept = 'apps' | 'mcp-servers' | 'skills' | 'knowledge' | 'packs'

/** The sort control's choices. */
export type CatalogSort = 'best' | 'added' | 'name' | 'newest'

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
  /** What the status line counts over the whole list; mirrors ahel's `ListingSummary`. */
  readonly summary: {
    readonly rows: number
    readonly apps: number
    readonly officialApps: number
    readonly skills: number
    readonly copies: number
  }
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
  /** The tile ahel.ai's Your apps draws for it, mark made absolute; absent when neither `installed` nor the listing had one. */
  readonly tile?: CatalogRowTile
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

/** One source a Knowledge product sells; from `GET /api/public/knowledge-products`. */
export interface KnowledgeSource {
  /** The catalog id, such as `ahel.datasets/companies-ee`. */
  readonly id: string
  readonly name: string
  readonly description: string
  readonly servable: boolean
  /** Absolute https URL of its ahel.ai page. */
  readonly href: string
}

/** One Knowledge product as ahel.ai/knowledge draws it; from `GET /api/public/knowledge-products`. */
export interface KnowledgeProduct {
  readonly id: string
  /** What `add` takes to install every source in one call, such as `knowledge:screening`. */
  readonly installId: string
  readonly name: string
  readonly promise: string
  readonly includes: string
  readonly cents: number
  /** "3¢ per query", as ahel.ai prints it. */
  readonly price: string
  readonly ask: string
  /** ahel.ai's glyph name: `building`, `shield-alert`, `gavel` or `bug`. */
  readonly glyph: string
  readonly sources: readonly KnowledgeSource[]
}

/** A catalog icon as ahel.ai sends it; a logo `src` may be a site path on ahel.ai. */
export type AhelIcon =
  | { readonly type: 'logo'; readonly src: string; readonly slug?: string }
  | { readonly type: 'glyph'; readonly glyph: string }
  | { readonly type: 'letter'; readonly letter: string }

/** A JSON value as ahel.ai sent it. */
export type AhelJson = string | number | boolean | null | readonly AhelJson[] | { readonly [key: string]: AhelJson }

/** One held call waiting for an owner or team lead; mirrors ahel's `ApprovalRowDto`. */
export interface ApprovalRow {
  readonly id: string
  /** `server.tool`, the call in one phrase. */
  readonly what: string
  readonly server: string | null
  readonly tool: string | null
  /** The exact arguments the requester's AI sent. */
  readonly args: { readonly [key: string]: AhelJson } | null
  readonly guardrailName: string
  readonly requester: { readonly email: string; readonly name: string | null } | null
  /** ISO timestamps; a pending call expires 24 h after `createdAt`. */
  readonly createdAt: string
  readonly expiresAt: string
}

/** The workspace balance line; money in whole US cents. */
export type DesktopCredits =
  | { readonly visible: false }
  | {
    readonly visible: true
    readonly balanceCents: number
    /** The whole workspace's spend since UTC midnight, net of refunds. */
    readonly workspaceSpentTodayCents: number
    readonly low: boolean
    readonly lowThresholdCents: number
    /** Only the owner tops up; others are told to ask the owner. */
    readonly canTopUp: boolean
    /** ahel.ai's billing page. */
    readonly topUpUrl: string
  }

/**
 * `GET /api/desktop/summary`: what the sidebar and account menu poll. A part
 * ahel.ai could not read is null; `approvals` is also null for a Member or a
 * plan without approval rules.
 */
export interface DesktopSummary {
  readonly workspace: { readonly id: string; readonly name: string; readonly role: string }
  readonly approvals: { readonly rows: readonly ApprovalRow[] } | null
  /** Received handoffs that are unread and not done. */
  readonly inbox: { readonly unread: number } | null
  readonly credits: DesktopCredits | null
  /** The caller as ahel.ai names them now; absent from an older ahel.ai. */
  readonly me?: DesktopMember | null
  /**
   * Active seats: `rows` has the caller first, then by join date, at most 8;
   * `total` counts them all. Absent from an older ahel.ai.
   */
  readonly members?: { readonly total: number; readonly rows: readonly DesktopMember[] } | null
  /** Switched-on rows of the Your apps inventory; absent from an older ahel.ai. */
  readonly apps?: { readonly installed: number } | null
  readonly at: string
}

/** One workspace seat in the summary. */
export interface DesktopMember {
  readonly id: string
  readonly name: string | null
  readonly email: string
}

/** The stored answer to one held call. Approve opens a one-hour window for the requester to repeat the exact call. */
export interface ApprovalDecision {
  readonly ok: true
  readonly id: string
  readonly status: 'approved' | 'declined'
  readonly expiresAt: string
}

/** One input of a key app's Connect form. `id` is opaque (`f0_0`); no credential type or variable name leaves ahel.ai. */
export interface KeyConnectField {
  readonly id: string
  readonly label: string
  /** Render as a password input. */
  readonly secret: boolean
  readonly required: boolean
  readonly placeholder?: string
  readonly defaultValue?: string
}

/** A key app's Connect panel; mirrors ahel's `KeyConnectView`. */
export interface KeyConnectView {
  readonly app: string
  readonly vendor: string
  readonly icon?: AhelIcon
  readonly keyPageUrl: string | null
  /** "Get the key in <Vendor>" steps, or null where only the key page is known. */
  readonly keySteps: readonly string[] | null
  readonly readOnlyEnough: boolean
  /** The values still missing; empty when connected. */
  readonly fields: readonly KeyConnectField[]
  readonly count: number | null
  readonly countNoun: 'action' | 'tool'
  readonly stackKey: string | null
  readonly connected: boolean
  /** Something to try once connected, or null. */
  readonly ask: string | null
}

/** One managed sign-in in the workspace vault; mirrors ahel's `VaultSignIn`. */
export interface VaultSignIn {
  readonly key: string
  readonly itemId: string | null
  readonly service: string | null
  readonly label: string
  readonly icon: AhelIcon | null
  /** Host name of the issuer. */
  readonly issuer: string
  readonly signedInAt: string
  /** The token has passed its expiry and has not been refreshed yet. */
  readonly expired: boolean
}

/** `GET /api/desktop/connect`: the workspace's sign-ins. */
export interface VaultSignInList {
  readonly signIns: readonly VaultSignIn[]
  /** Whether this seat may connect and disconnect (owner or team lead). */
  readonly canManage: boolean
}

/** `GET /api/desktop/connect?app=`: one app's Connect state. */
export interface KeyConnectAnswer {
  /** Null for a sign-in app, a keyless app, or one that needs an account choice on ahel.ai. */
  readonly panel: KeyConnectView | null
  readonly signIn: VaultSignIn | null
  readonly canManage: boolean
  /** The app's page in the ahel.ai vault. */
  readonly webUrl: string
}

/** The result of saving a key app's values: its panel after the save. */
export interface KeyConnectSaved {
  readonly panel: KeyConnectView | null
}

/** The result of disconnecting an app; `removed` is false when nothing was stored. */
export interface VaultDisconnected {
  readonly ok: true
  readonly removed: boolean
}

/** Handoff section ids; `goal` (4000 chars) and `next` (2000 chars) are required. */
export type HandoffSectionId = 'goal' | 'decisions' | 'changes' | 'references' | 'tests' | 'open' | 'next'

/** The text of a handoff by section. */
export type HandoffSections = Readonly<Partial<Record<HandoffSectionId, string>>>

/** One handoff section as ahel.ai shows it back. */
export interface HandoffSectionRow {
  readonly id: HandoffSectionId
  readonly label: string
  readonly help: string
  readonly required: boolean
  readonly maxLength: number
  readonly value: string
}

/** What ahel.ai recorded itself about a handoff, as opposed to what the AI wrote. */
export interface HandoffEvidence {
  readonly author: { readonly name: string | null; readonly email: string; readonly verified: true }
  readonly workspace: { readonly id: string; readonly name: string }
  readonly sentAt: string
  readonly note: string
}

/** One received handoff in the Inbox. */
export interface HandoffReceivedRow {
  readonly id: string
  readonly title: string
  readonly version: number
  readonly status: string
  readonly unread: boolean
  readonly updatedAt: string
  readonly url: string
  readonly from: string
  /** First line of the next step. */
  readonly next: string
  readonly secretsRemoved: number
}

/** One handoff this person sent. */
export interface HandoffSentRow {
  readonly id: string
  readonly title: string
  readonly version: number
  readonly status: string
  readonly recipients: number
  readonly read: boolean
  readonly updatedAt: string
  readonly url: string
  readonly from: string
  readonly next: string
  readonly secretsRemoved: number
}

/** `GET /api/desktop/handoffs`: the Inbox. */
export interface HandoffList {
  readonly view: 'handoff_list'
  readonly scope: 'all' | 'received' | 'sent'
  readonly received: readonly HandoffReceivedRow[]
  readonly sent: readonly HandoffSentRow[]
  readonly detail: string
}

/** One opened handoff; opening marks it read. */
export interface HandoffRead {
  readonly view: 'handoff_read'
  readonly id: string
  readonly title: string
  readonly version: number
  readonly latestVersion: number
  readonly status: string
  readonly secretsRemoved: number
  readonly from: string
  readonly sentAt: string
  readonly sections: readonly HandoffSectionRow[]
  readonly evidence: HandoffEvidence
  readonly unverifiedNote: string
  readonly screened: 'clean' | 'flagged'
  readonly screenedReason: string | null
  readonly url: string
  /** The reader-safe wrapped report to seed a new session with; information, never instructions. */
  readonly text: string
}

/** The editable preview `prepare` returns; nothing is stored yet. */
export interface HandoffReview {
  readonly view: 'handoff_review'
  readonly title: string
  readonly sections: readonly HandoffSectionRow[]
  readonly evidence: HandoffEvidence
  readonly unverifiedNote: string
  /** Teammates to pick from; `value` is the user id `shareHandoff` takes. */
  readonly recipients: readonly { readonly value: string; readonly label: string; readonly role: string }[]
  readonly selected: string | null
  /** Redaction and screening notices to show before Share. */
  readonly warnings: readonly string[]
  readonly noTeammates: boolean
  readonly inviteUrl: string
  /** `requestKey` makes a retried Share the same delivery. */
  readonly continuation: { readonly key: string; readonly tool: string; readonly requestKey: string }
  readonly submit: string
  readonly footnote: string
}

/** A shared, repeated or done handoff. */
export interface HandoffSent {
  readonly view: 'handoff_sent'
  readonly id: string
  readonly title: string
  readonly version: number
  /** Present on `markHandoffDone`. */
  readonly status?: string
  /** How many teammates it reaches. */
  readonly recipients: number
  readonly recipientNames?: readonly string[]
  readonly url: string
  /** True when this Share or Done had already happened. */
  readonly repeated: boolean
  readonly detail: string
  readonly warnings?: readonly string[]
}

/** The draft `prepareHandoff` takes. */
export interface HandoffDraft {
  readonly title: string
  readonly sections: HandoffSections
}

/** What `shareHandoff` sends after the person pressed Share. */
export interface HandoffShare extends HandoffDraft {
  /** One to five teammate user ids from `HandoffReview.recipients`. */
  readonly recipients: readonly string[]
  /** `HandoffReview.continuation.requestKey`. */
  readonly requestKey: string
}

/** What one local chat offers to prefill a handoff; empty strings where the chat could not be read. */
export interface HandoffSessionDraft {
  /** The chat's title, up to 120 characters. */
  readonly title: string
  /** The first message the person typed, up to 4000 characters. */
  readonly goal: string
  /** The last assistant reply's text, up to 6000 characters. */
  readonly changes: string
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

/** Issues shapes (the `ahelIssues` Remote boundary) live beside this file. */
export type * from './issues-types.ts'
