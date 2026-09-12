# Data layer (`src/data`)

Pure policy and the few data hooks the native shell still owns. Everything
about threads, projects, plugins and settings runs in the web page inside
the WebView, which has its own query client; the native `QueryClient` only
caches the system config the palette sync reads.

- `connect/` backs bb connect enrollment: `parseConnectPairingPayload` (QR
  JSON, `bb://connect?code=…` link, or a bare code),
  `resolveEnrollmentTarget` (server handle or URL, optional self-hosted
  apex), `redeemEnrollment` + `describeEnrollmentError` (redeem the pairing
  code, map wire errors to copy), `accountServerProfile`, and
  `useAccountServers` (the other servers the credential's account owns).
  Pure modules are vitest-tested.
- `notifications/` is the push layer's policy, pure and vitest-tested; the RN
  glue (expo-notifications, MMKV, navigation) lives in `src/notifications`.
  `push-registration.ts`: `decidePushSync` (toggle × EAS project id × OS
  permission × existing record → skip / unregister / fetch-token),
  `shouldReregister` (token / platform / server change, daily refresh),
  `syncPushRegistration` (never throws; removes the stale row before a
  re-register), `unregisterPushRegistration` (by profile id: the record keeps
  the server URL, so a removed profile can still be cleaned up),
  `enablePushForProfile` (asks the OS once), `describePushStatus`.
  `push-registration-controller.ts` coalesces concurrent syncs per profile
  and reconciles removed profiles / token rolls. `push-store.ts` is the
  injected-storage store (MMKV `bb.preferences` in the app, a Map in tests).
  `push-subscriptions-api.ts` calls the `push-notifications` plugin RPC
  through `sdk.plugins.callRpc`. It keys clients by server URL, not by a
  profile client that the app can dispose. Its list reads local validated
  records with `tokenSuffix`.
  `push-notification-target.ts` parses a payload's `data` and picks the
  profile (matching server hint → probe active first).
- `shared/use-realtime-subscription.ts`: `useSystemRealtimeSubscription`
  holds the active profile's `system` realtime subscription while a system
  query is mounted (refcounted per target by the realtime manager).
- `system/system-queries.ts`: `useSystemConfig` (`GET /system/config`, key
  from `@/lib/query/query-keys`). `@/lib/query/realtime-invalidation.ts`
  invalidates it on `host` and `system` changes and catches up stale queries
  after a reconnect.
