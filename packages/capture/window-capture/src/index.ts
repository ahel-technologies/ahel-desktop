/**
 * Front-window capture for Ahel Desktop. The Electron shell calls
 * `captureFrontWindow` with the macOS backend when the global shortcut fires; the composer plugin turns the
 * result into attachments with `windowCaptureFiles` from `./protocol`.
 */
export { captureFrontWindow, isPng } from './capture.ts'
export type { CaptureFrontWindowRequest, FrontWindow, WindowCapturer } from './capture.ts'
export { macWindowCapturer } from './mac.ts'
export type { MacCaptureTimeouts } from './mac.ts'
export { DEFAULT_WINDOW_CAPTURE_ACCELERATOR, windowCaption, windowCaptureFiles } from './protocol.ts'
export type {
  WindowCapture, WindowCaptureBridge, WindowCaptureFailure, WindowCaptureResult, WindowCaptureShortcut, WindowCaptureShortcutResult,
} from './protocol.ts'
