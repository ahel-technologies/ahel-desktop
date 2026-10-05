/**
 * Content security for an MCP Apps document rendered through `srcdoc`.
 *
 * The card iframe is sandboxed without `allow-same-origin`, so the document
 * runs in an opaque origin with no access to the host page, its storage, or
 * its cookies. The policy below is the MCP Apps specification policy built
 * from the resource's declared domains, delivered as the first element of the
 * document head before any resource-loading element is parsed.
 */

import type { McpAppCsp } from './record.ts'

/** Sandbox tokens of the card iframe: scripts and in-document form handling only. */
export const APP_FRAME_SANDBOX = 'allow-scripts allow-forms'

/** A CSP source entry that cannot inject another directive or keyword. */
const SAFE_SOURCE = /^[A-Za-z][A-Za-z0-9+.-]*:\/\/(?:\*\.)?[A-Za-z0-9.-]+(?::\d+)?(?:\/[^\s;,'"]*)?$|^[A-Za-z0-9.-]+$/

/**
 * Keep declared domain entries that are plain scheme-host sources.
 * @param entries - domains declared by the resource.
 * @returns entries safe to place in a CSP directive.
 */
export function safeSources(entries: readonly string[] | undefined): string[] {
  return (entries ?? []).filter(entry => SAFE_SOURCE.test(entry))
}

/**
 * Build the MCP Apps content security policy for one resource.
 * Without a declared `csp`, the specification default applies: no network,
 * inline scripts and styles, and `data:` images and media.
 * @param csp - the resource's declared domains, if any.
 * @returns the policy text.
 */
export function appContentSecurityPolicy(csp: McpAppCsp | undefined): string {
  if (csp === undefined) {
    return [
      "default-src 'none'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "media-src 'self' data:",
      "object-src 'none'",
      "connect-src 'none'",
      "frame-src 'none'",
      "base-uri 'self'",
      "form-action 'none'",
    ].join('; ')
  }
  const join = (sources: string[]): string => sources.length === 0 ? '' : ` ${sources.join(' ')}`
  const resources = join(safeSources(csp.resourceDomains))
  const connect = join(safeSources(csp.connectDomains))
  const frames = safeSources(csp.frameDomains)
  const bases = safeSources(csp.baseUriDomains)
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline'${resources}`,
    `style-src 'self' 'unsafe-inline'${resources}`,
    `connect-src 'self'${connect}`,
    `img-src 'self' data:${resources}`,
    `font-src 'self'${resources}`,
    `media-src 'self' data:${resources}`,
    `frame-src ${frames.length === 0 ? "'none'" : frames.join(' ')}`,
    "object-src 'none'",
    `base-uri ${bases.length === 0 ? "'self'" : bases.join(' ')}`,
    "form-action 'none'",
  ].join('; ')
}

/**
 * Prepend the policy to the document head. Parsing through `DOMParser`
 * executes no script; the serialized document carries the policy element
 * before every element the server wrote.
 * @param html - the resource's HTML document.
 * @param policy - the content security policy text.
 * @returns the document text for `srcdoc`.
 */
export function withContentSecurityPolicy(html: string, policy: string): string {
  const parsed = new DOMParser().parseFromString(html, 'text/html')
  const element = parsed.createElement('meta')
  element.setAttribute('http-equiv', 'Content-Security-Policy')
  element.setAttribute('content', policy)
  parsed.head.prepend(element)
  return `<!doctype html>${parsed.documentElement.outerHTML}`
}
