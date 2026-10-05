# Phase 2 wiring: Ahel login in the desktop shell

Apply after `phase1/strip-rebrand` merges. New packages: `@deepseek-ai/dsh-ahel-account` (service `ctx.ahelAccount`, Remote namespace `ahelAccount`) and `@deepseek-ai/dsh-llm-ahel` (route `ahel`).

## 1. Bundle rows (`packages/bundle/base`)

1. Insert the rows of [mcp-ahel.cordis.patch.yml](mcp-ahel.cordis.patch.yml) after the `credentials` row, and the row of [llm-ahel.cordis.patch.yml](llm-ahel.cordis.patch.yml) after `llm-pi-ai`.
2. Add `@deepseek-ai/dsh-ahel-account` and `@deepseek-ai/dsh-llm-ahel` (`workspace:*`) to `packages/bundle/base/package.json` dependencies (`verify-cordis-config` requires it).

## 2. Host RPC client (`apps/desktop/src`)

1. Restore `account-backend.ts` from `spike/phase-0` as `ahel-account-backend.ts`: namespace `ahelAccount`, methods `state`, `signIn`, `cancelSignIn(attemptId)`, `signOut`, `profile`; stream endpoint `ahelAccount/watch`. Drop `links`, `watchExpiry`, analytics and `AccountClientMetadata`; validate `AhelAccountView` from `@deepseek-ai/dsh-ahel-account/types`.
2. Connect it in the backend `start()` the way `spike/phase-0` `main.ts:455-498` did (`connectDesktopWelcome` + `watch`).
3. In the watch callback: when `attempt.phase === 'waiting-browser'` and `attempt.authorizeUrl` is new, call `shell.openExternal(attempt.authorizeUrl)` (allow only `https:`). The Host never opens a browser itself; without a shell it logs the URL.
4. On `status === 'signed-in'` with `attempt.phase === 'succeeded'` while the welcome is open, call `enterWorkspace()`. On a change from `signed-in` to `signed-out`, show the welcome again.

## 3. Welcome window

1. `welcome-api.ts`: `needsWelcome(signedIn: boolean)` returns `!signedIn`; the caller passes `(await ahelAccount.state()).status === 'signed-in'` instead of the welcome-seen marker. Delete `WELCOME_SEEN_MARKER`.
2. `WELCOME_IPC`: add `signIn` and `cancel` channels; `WelcomeOperations` gains `signIn(): Promise<AhelAccountView>` and `cancel(id)`, backed by `ahelAccount.signIn()` / `cancelSignIn(id)`. Forward each watched view to the renderer.
3. `WelcomePage.tsx`: enable `#sign-in` (copy `welcomeSignIn: 'Sign in with Ahel'`), show "Waiting for your browser" with Cancel while `waiting-browser`/`exchanging`, and map `errorCode` (`denied`, `timeout`, `network`, `protocol`, `storage`) to locale strings. Keep **Continue** as "use my own key" (BYO), not a bypass of sign-in, if Karl wants keyless use.
4. Update `apps/desktop/tests/expected/welcome/*.expected.txt` and `welcome-window.spec.ts`.

## 4. Sidebar account menu (client)

1. Read `ahelAccount.state()`/`watch` through the typert remote client (`@deepseek-ai/dsh-ahel-account/remote`); show `profile.name ?? profile.email` and the workspace names.
2. Menu items: "Account on ahel.ai" (open `https://ahel.ai/app/settings` externally), "Sign out" → `ahelAccount.signOut()` (revokes, deletes `AHEL_ACCOUNT`, MCP tools disappear, welcome returns). Use `profile()` for a live refresh when the menu opens.

## 5. Models: Ahel next to bring-your-own keys

1. The `ahel` route is registered by `llm-ahel` directly; BYO routes (`anthropic`, `openai`) stay in `llm-pi-ai` with `apiKeyEnv` keys written by Settings → Models. Both appear in the model picker; route keys never collide.
2. Settings → Models lists configurable providers only, so Ahel has no key field there. Add one read-only row: "Ahel (your ahel.ai account)" with the sign-in state and the 402/403 hint.
3. Default model after sign-in: `ahel/<first listed model>` when no BYO route is configured; otherwise keep the user's choice.
4. Signed out, Ahel requests fail with `MISSING_CREDENTIAL` ("Sign in to Ahel…"); 402 gives code `QUOTA`, 403 code `AUTH`, both with the ahel.ai sentence.
