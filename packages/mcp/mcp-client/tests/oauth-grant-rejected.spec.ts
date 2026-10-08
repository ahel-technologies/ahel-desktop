import { describe, expect, it } from 'vitest'
import type { CredentialProvider, CredentialRef } from '@ahel/dsh-credentials'
import { currentOAuthGrant, type StoredOAuthGrant } from '../src/oauth.ts'

interface Seam { credentials: CredentialProvider; state: { value: string | undefined; unsets: number } }

/** A credentials seam over one in-memory record. */
function seam(initial: string | undefined): Seam {
  const state = { value: initial, unsets: 0 }
  const credentials = {
    async resolve(ref: string) { return state.value === undefined ? undefined : { ref, value: state.value } },
    async set(_ref: string, value: string) { state.value = value },
    async unset(_ref: string) { state.unsets += 1; state.value = undefined },
  } as unknown as CredentialProvider
  return { credentials, state }
}

const grant: StoredOAuthGrant = {
  version: 1, issuer: 'https://ahel.test', token_endpoint: 'https://ahel.test/api/auth/mcp/token', client_id: 'c',
  access_token: 'old-access', expires_at: 0, refresh_token: 'old-refresh',
}
const rejecting: typeof fetch = async () => new Response(JSON.stringify({ error: 'invalid_grant' }), { status: 400, headers: { 'content-type': 'application/json' } })

describe('currentOAuthGrant on a rejected refresh', () => {
  it('removes the record by default', async () => {
    const { credentials, state } = seam(JSON.stringify(grant))
    await expect(currentOAuthGrant(credentials, 'AHEL_ACCOUNT' as CredentialRef, { refreshSkewMs: 0, fetchImpl: rejecting, now: () => 1 })).rejects.toThrow()
    expect(state.unsets).toBe(1)
    expect(state.value).toBeUndefined()
  })

  it('keeps the record with keepRejected, so a replacement Host on the same volume loses nothing', async () => {
    const { credentials, state } = seam(JSON.stringify(grant))
    await expect(currentOAuthGrant(credentials, 'AHEL_ACCOUNT' as CredentialRef, { refreshSkewMs: 0, fetchImpl: rejecting, now: () => 1, keepRejected: true })).rejects.toThrow()
    expect(state.unsets).toBe(0)
    expect(state.value).toBe(JSON.stringify(grant))
  })
})
