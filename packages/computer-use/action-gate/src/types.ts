/**
 * Wire-safe computer-use views shared by the gate and the approval UI.
 * @module @ahel/dsh-computer-use-action-gate/types
 */

/** How the gate treats one Cua tool name. */
export type ActionClass = 'read' | 'write' | 'unknown'

/** Where an activity row stands. */
export type ComputerUseStatus =
  /** A read ran without a card. */
  | 'read'
  /** A write is waiting for the user's click. */
  | 'asked'
  /** The user approved; the action is running. */
  | 'approved'
  /** The approved action finished. */
  | 'done'
  /** The approved action ran and returned an error. */
  | 'failed'
  /** The user denied, or the approval was withdrawn. */
  | 'rejected'
  /** The gate refused before asking: off, paused, unknown tool, or no target. */
  | 'denied'
  /** The target is on the hard-block list. */
  | 'blocked'

/** A rectangle of the latest window screenshot, in screenshot pixels. */
export interface ComputerUseCrop {
  /** Image media type, for example `image/png`. */
  readonly mimeType: string
  /** Base64 image bytes of the whole window screenshot. */
  readonly data: string
  /** Screenshot width in pixels, when the driver reported it. */
  readonly imageWidth: number | null
  /** Screenshot height in pixels, when the driver reported it. */
  readonly imageHeight: number | null
  /** Left edge of the target rectangle. */
  readonly x: number
  /** Top edge of the target rectangle. */
  readonly y: number
  /** Width of the target rectangle. */
  readonly width: number
  /** Height of the target rectangle. */
  readonly height: number
}

/** The element an action is aimed at, from the latest accessibility observation. */
export interface ComputerUseElement {
  /** Accessibility role, for example `AXButton`. */
  readonly role: string
  /** Title, description or value the driver reported as its label. */
  readonly label: string | null
}

/** Everything the approval card shows for one pending write. */
export interface ComputerUseCard {
  /** The tool call this card decides. */
  readonly callId: string
  /** Session the call belongs to. */
  readonly sessionId: string
  /** Raw Cua tool name, for example `type_text`. */
  readonly action: string
  /** One-line plain description, for example `Type into “To:” in Mail`. */
  readonly summary: string
  /** Target app name. */
  readonly app: string | null
  /** Target app bundle id. */
  readonly bundleId: string | null
  /** Target window title. */
  readonly window: string | null
  /** Target element. */
  readonly element: ComputerUseElement | null
  /** Exact text that will be typed or set. */
  readonly text: string | null
  /** Exact key or key combination that will be pressed. */
  readonly keys: string | null
  /** Screenshot-pixel point for pixel actions. */
  readonly point: { readonly x: number; readonly y: number } | null
  /** A crop of the target from the latest screenshot. */
  readonly crop: ComputerUseCrop | null
  /** The call's arguments as indented JSON, for the details fold. */
  readonly args: string
}

/** One compact activity row. */
export interface ComputerUseActivityRow {
  /** The tool call. */
  readonly callId: string
  /** Epoch milliseconds when the gate saw the call. */
  readonly time: number
  /** Raw Cua tool name. */
  readonly action: string
  /** One-line description. */
  readonly summary: string
  /** Target app, when known. */
  readonly app: string | null
  /** Current status. */
  readonly status: ComputerUseStatus
  /** Why the call was refused or failed. */
  readonly reason: string | null
}

/** Computer-use state of one session. */
export interface ComputerUseSessionView {
  /** The session. */
  readonly sessionId: string
  /** A turn in this session used computer use and is still running. */
  readonly running: boolean
  /** The user paused computer use for this session. */
  readonly paused: boolean
  /** Newest-last activity rows. */
  readonly activity: readonly ComputerUseActivityRow[]
}

/** Complete computer-use state for the UI. */
export interface ComputerUseView {
  /** Whether computer use is turned on (`computerUse.enabled`). */
  readonly enabled: boolean
  /** Apps the user added to the block list. */
  readonly blockedApps: readonly string[]
  /** Apps that are always blocked. */
  readonly builtInBlocked: readonly string[]
  /** Sessions with computer-use activity. */
  readonly sessions: readonly ComputerUseSessionView[]
}
