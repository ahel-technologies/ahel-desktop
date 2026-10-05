/**
 * Host half of the Electron `safeStorage` bridge. The Desktop Host is a child
 * of the Electron main process with an IPC channel; only the main process can
 * reach `safeStorage`, so the Host sends one request per operation and the
 * main process answers it with the same `requestId`.
 * @module
 */

/** Message type the Host sends for one `safeStorage` operation. */
export const SAFE_STORAGE_REQUEST = 'safe-storage-request'
/** Message type the Electron main process answers with. */
export const SAFE_STORAGE_RESPONSE = 'safe-storage-response'

/** One `safeStorage` operation; `data` is UTF-8 text to encrypt or base64 ciphertext to decrypt. */
export interface SafeStorageRequest {
  readonly type: typeof SAFE_STORAGE_REQUEST
  readonly requestId: number
  readonly operation: 'available' | 'encrypt' | 'decrypt'
  readonly data?: string
}

/** Answer to one {@link SafeStorageRequest}: `available` for availability, `data` for encrypt/decrypt, or `error`. */
export interface SafeStorageResponse {
  readonly type: typeof SAFE_STORAGE_RESPONSE
  readonly requestId: number
  readonly available?: boolean
  readonly data?: string
  readonly error?: string
}

/** Encryption operations backed by the OS keystore through the Electron main process. */
export interface SafeStorageBridge {
  /** @returns whether the OS keystore can encrypt (`safeStorage.isEncryptionAvailable()`). */
  isEncryptionAvailable(): Promise<boolean>
  /** @param text - UTF-8 plaintext. @returns base64 ciphertext. */
  encrypt(text: string): Promise<string>
  /** @param ciphertext - base64 ciphertext from {@link encrypt}. @returns the plaintext. */
  decrypt(ciphertext: string): Promise<string>
  /** Reject pending requests and stop listening. */
  close(): void
}

/** The IPC side of a process: Node's child-process channel to its parent. */
export interface IpcProcess {
  readonly connected?: boolean
  send?: (message: SafeStorageRequest, callback: (error: Error | null) => void) => boolean
  on(event: 'message', listener: (message: unknown) => void): unknown
  off(event: 'message', listener: (message: unknown) => void): unknown
}

/** Deadline for one answer; the main process answers synchronously, so a miss means no bridge handler. */
const RESPONSE_DEADLINE_MS = 10_000

function isResponse(message: unknown): message is SafeStorageResponse {
  return typeof message === 'object' && message !== null
    && (message as { type?: unknown }).type === SAFE_STORAGE_RESPONSE
    && Number.isSafeInteger((message as { requestId?: unknown }).requestId)
}

/**
 * Connect to the parent process's `safeStorage` handler.
 * @param channel - the process whose IPC channel reaches the Electron main process.
 * @returns the bridge, or `undefined` when the process has no IPC channel (not launched by the Desktop shell).
 */
export function connectSafeStorageBridge(channel: IpcProcess = process): SafeStorageBridge | undefined {
  if (channel.send === undefined || channel.connected !== true) return undefined
  const send = channel.send.bind(channel)
  let nextId = 1
  const pending = new Map<number, { resolve: (response: SafeStorageResponse) => void; reject: (error: Error) => void }>()
  const listener = (message: unknown): void => {
    if (!isResponse(message)) return
    const request = pending.get(message.requestId)
    if (request === undefined) return
    pending.delete(message.requestId)
    if (message.error === undefined) request.resolve(message)
    else request.reject(new Error(`safeStorage: ${message.error}`))
  }
  channel.on('message', listener)
  const call = (operation: SafeStorageRequest['operation'], data?: string): Promise<SafeStorageResponse> => {
    const requestId = nextId++
    return new Promise<SafeStorageResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        reject(new Error(`safeStorage: no answer to ${operation} within ${String(RESPONSE_DEADLINE_MS)} ms`))
      }, RESPONSE_DEADLINE_MS)
      timer.unref()
      pending.set(requestId, {
        resolve: (response) => { clearTimeout(timer); resolve(response) },
        reject: (error) => { clearTimeout(timer); reject(error) },
      })
      send({ type: SAFE_STORAGE_REQUEST, requestId, operation, ...data === undefined ? {} : { data } }, (error) => {
        if (error === null) return
        pending.get(requestId)?.reject(error)
        pending.delete(requestId)
      })
    })
  }
  const text = (response: SafeStorageResponse): string => {
    if (typeof response.data !== 'string') throw new Error('safeStorage: answer carries no data')
    return response.data
  }
  return {
    isEncryptionAvailable: async () => (await call('available')).available === true,
    encrypt: async plaintext => text(await call('encrypt', plaintext)),
    decrypt: async ciphertext => text(await call('decrypt', ciphertext)),
    close: () => {
      channel.off('message', listener)
      for (const request of pending.values()) request.reject(new Error('safeStorage: bridge closed'))
      pending.clear()
    },
  }
}
