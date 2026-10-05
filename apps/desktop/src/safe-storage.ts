/** Main-process half of the Host's `safeStorage` bridge (`@ahel/dsh-credentials-safe-storage`). */

import { safeStorage } from 'electron'

/** One validated Host request; `data` is plaintext for encrypt and base64 ciphertext for decrypt. */
export interface DesktopSafeStorageRequest {
  readonly type: 'safe-storage-request'
  readonly requestId: number
  readonly operation: 'available' | 'encrypt' | 'decrypt'
  readonly data?: string
}

/** Answer sent back to the Host under the request's `requestId`. */
export interface DesktopSafeStorageResponse {
  readonly type: 'safe-storage-response'
  readonly requestId: number
  readonly available?: boolean
  readonly data?: string
  readonly error?: string
}

/**
 * Run one request against Electron `safeStorage` (Keychain on macOS, DPAPI on Windows).
 * @param request - validated Host request.
 * @returns the answer; failures carry `error` instead of throwing.
 */
export function answerSafeStorageRequest(request: DesktopSafeStorageRequest): DesktopSafeStorageResponse {
  const { requestId } = request
  try {
    switch (request.operation) {
      case 'available':
        return { type: 'safe-storage-response', requestId, available: safeStorage.isEncryptionAvailable() }
      case 'encrypt':
        return { type: 'safe-storage-response', requestId, data: safeStorage.encryptString(request.data ?? '').toString('base64') }
      case 'decrypt':
        return { type: 'safe-storage-response', requestId, data: safeStorage.decryptString(Buffer.from(request.data ?? '', 'base64')) }
    }
  } catch (error) {
    return { type: 'safe-storage-response', requestId, error: error instanceof Error ? error.message : String(error) }
  }
}
