/** Interactive MCP Apps card rendered under a settled MCP tool call. */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { StateDot } from '@ahel/dsh-client-ui-primitives'
import type { JsonValue } from '@ahel/dsh-util-values'
import type { McpAppJsonObject } from '../types.ts'
import { McpAppBridge, type McpAppHostContext } from './bridge.ts'
import { appContentSecurityPolicy, APP_FRAME_SANDBOX, withContentSecurityPolicy } from './document.ts'
import { readAppRecord, readAppResource, type McpAppRecord } from './record.ts'
import type { McpAppCardProps } from './contract.ts'
import css from './McpAppCard.module.css'

/** Height of the frame before the app reports its size. */
const INITIAL_FRAME_HEIGHT = 120

/** Longest wait for the app's teardown answer; unmount does not wait. */
const TEARDOWN_TIMEOUT_MS = 500

type CardState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready'; readonly srcDoc: string; readonly prefersBorder?: boolean; readonly resultMeta: McpAppJsonObject | null }
  | { readonly kind: 'failed'; readonly reason: 'failed' | 'tooLarge' | 'navigated' }

/** Parse the recorded call arguments; a malformed or out-of-window call sends `{}`. */
function callArguments(argsRaw: string | undefined): McpAppJsonObject {
  if (argsRaw === undefined) return {}
  try {
    const parsed: unknown = JSON.parse(argsRaw)
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as McpAppJsonObject : {}
  } catch {
    // Unparsable recorded arguments are sent as an empty object.
    return {}
  }
}

/** Text blocks of the model-facing result, joined for the fallback view. */
function resultText(content: readonly { type: string; text?: string }[]): string {
  return content.flatMap(block => block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n')
}

/** MCP text content blocks rebuilt from the model-facing result. */
function mcpContent(content: readonly { type: string; text?: string }[]): JsonValue[] {
  return content.flatMap(block => block.type === 'text' && typeof block.text === 'string'
    ? [{ type: 'text', text: block.text }]
    : [])
}

/** Spec style variables mapped from the host's current design tokens. */
const STYLE_TOKENS: readonly (readonly [string, string])[] = [
  ['--font-sans', '--dsw-font-family'],
  ['--font-mono', '--ds-font-family-code'],
  ['--color-text-primary', '--dsw-alias-label-primary'],
  ['--color-text-secondary', '--dsw-alias-label-secondary'],
  ['--color-text-tertiary', '--dsw-alias-label-tertiary'],
  ['--color-text-danger', '--dsw-alias-state-error-primary'],
  ['--color-text-success', '--dsw-alias-state-success-primary'],
  ['--color-background-primary', '--dsw-alias-bg-base'],
  ['--color-background-secondary', '--dsw-alias-bg-layer-1'],
  ['--color-border-primary', '--dsw-alias-border-l1'],
  ['--color-border-secondary', '--dsw-alias-border-l2'],
  ['--border-radius-sm', '--dsw-radius-sm'],
  ['--border-radius-lg', '--dsw-radius-lg'],
]

/** Read the mapped style variables from the document's computed tokens. */
function styleVariables(): { [name: string]: string } {
  const computed = getComputedStyle(document.documentElement)
  const variables: { [name: string]: string } = {}
  for (const [spec, token] of STYLE_TOKENS) {
    const value = computed.getPropertyValue(token).trim()
    if (value !== '') variables[spec] = value
  }
  return variables
}

/**
 * @param props - the settled call, the card's server access, theme, and locale.
 * @returns the sandboxed card, its loading state, or the text fallback.
 */
export function McpAppCard(props: McpAppCardProps) {
  const record = useMemo(() => readAppRecord(props.block.meta), [props.block.meta])
  if (record === null) return null
  return <McpAppFrame {...props} record={record} />
}

function McpAppFrame({
  block, toolName, record, readResource, resultMeta, callTool, updateModelContext, openLink, maxHeight, platform, useColorScheme, t,
}: McpAppCardProps & { record: McpAppRecord }) {
  const colorScheme = useColorScheme(scheme => scheme)
  const [state, setState] = useState<CardState>(record.truncated ? { kind: 'failed', reason: 'tooLarge' } : { kind: 'loading' })
  const [height, setHeight] = useState(INITIAL_FRAME_HEIGHT)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const bridgeRef = useRef<McpAppBridge | null>(null)
  const { server, resourceUri, truncated } = record

  useEffect(() => {
    if (truncated) return undefined
    const abort = new AbortController()
    setState({ kind: 'loading' })
    // Result `_meta` (for example a press token) lives only in Host memory;
    // after a Host restart the card renders without it.
    const meta = resultMeta(block.callId).catch(() => null)
    readResource(server, resourceUri, abort.signal).then(async (result) => {
      const resource = readAppResource(result, resourceUri)
      const srcDoc = withContentSecurityPolicy(resource.html, appContentSecurityPolicy(resource.csp))
      const live = await meta
      if (!abort.signal.aborted) {
        setState({
          kind: 'ready', srcDoc, resultMeta: live,
          ...resource.prefersBorder === undefined ? {} : { prefersBorder: resource.prefersBorder },
        })
      }
    }).catch(() => {
      if (!abort.signal.aborted) setState({ kind: 'failed', reason: 'failed' })
    })
    return () => { abort.abort() }
  }, [server, resourceUri, truncated, readResource, resultMeta, block.callId])

  const hostContext = useMemo((): McpAppHostContext => ({
    theme: colorScheme,
    displayMode: 'inline',
    availableDisplayModes: ['inline'],
    containerDimensions: { maxHeight },
    locale: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform,
    userAgent: 'ahel-desktop',
    styles: { variables: styleVariables() },
  }), [colorScheme, maxHeight, platform])
  const hostContextRef = useRef(hostContext)
  hostContextRef.current = hostContext

  const srcDoc = state.kind === 'ready' ? state.srcDoc : undefined
  const liveMeta = state.kind === 'ready' ? state.resultMeta : null
  // Layout effect: the listener must exist before the srcdoc document's first
  // script can post `ui/initialize`, which happens in a later task.
  useLayoutEffect(() => {
    const frame = frameRef.current
    if (srcDoc === undefined || frame === null) return undefined
    const bridge = new McpAppBridge({
      post: (message) => { frame.contentWindow?.postMessage(message, '*') },
      hostInfo: { name: 'ahel-desktop', version: '1' },
      hostContext: hostContextRef.current,
      handlers: {
        callTool: (name, args, signal) => callTool(server, name, args, signal),
        readResource: (uri, signal) => readResource(server, uri, signal),
        openLink,
        hasUserActivation: () => navigator.userActivation.isActive,
        updateModelContext: (update) => { updateModelContext(server, update) },
        sizeChanged: (size) => {
          if (size.height !== undefined) setHeight(Math.ceil(size.height))
        },
      },
    })
    bridgeRef.current = bridge
    bridge.sendToolInput(callArguments(block.call?.argsRaw))
    bridge.sendToolResult({
      content: mcpContent(block.content),
      ...record.structuredContent === undefined ? {} : { structuredContent: record.structuredContent },
      ...liveMeta === null ? {} : { _meta: liveMeta },
    })
    // The opaque-origin frame posts with origin "null"; only its own window is accepted.
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frame.contentWindow || event.origin !== 'null') return
      bridge.receive(event.data)
    }
    let loads = 0
    const onLoad = (): void => {
      loads += 1
      // A second load means the frame navigated: stop talking to whatever it shows now.
      if (loads > 1) {
        bridge.dispose()
        setState({ kind: 'failed', reason: 'navigated' })
      }
    }
    window.addEventListener('message', onMessage)
    frame.addEventListener('load', onLoad)
    return () => {
      window.removeEventListener('message', onMessage)
      frame.removeEventListener('load', onLoad)
      bridgeRef.current = null
      void bridge.teardown(TEARDOWN_TIMEOUT_MS)
      bridge.dispose()
    }
    // The bridge lives exactly as long as one srcdoc document; record fields are fixed for it.
  }, [srcDoc])

  useEffect(() => {
    bridgeRef.current?.setHostContext(hostContext)
  }, [hostContext])

  if (state.kind === 'failed') {
    const text = resultText(block.content)
    return (
      <div className={css.fallback} data-mcp-app-fallback={state.reason}>
        <p className={css.notice}>{t(state.reason)}</p>
        {text === '' ? null : <div className={css.fallbackText}>{text}</div>}
        {record.structuredContent === undefined ? null : (
          <details className={css.structured}>
            <summary>{t('structured')}</summary>
            <pre>{JSON.stringify(record.structuredContent, null, 2)}</pre>
          </details>
        )}
      </div>
    )
  }
  if (state.kind === 'loading') {
    return (
      <div className={css.loading} role="status" aria-label={t('loading')} data-mcp-app-loading>
        <StateDot state="ongoing" size={14} />
      </div>
    )
  }
  return (
    <div className={state.prefersBorder === false ? css.frameless : css.card} data-mcp-app={record.resourceUri}>
      <iframe
        ref={frameRef}
        className={css.frame}
        title={t('frame', { tool: toolName })}
        sandbox={APP_FRAME_SANDBOX}
        srcDoc={state.srcDoc}
        referrerPolicy="no-referrer"
        style={{ height: Math.min(height, maxHeight) }}
      />
    </div>
  )
}
