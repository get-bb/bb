// Maestro runScript: put the harness server's settings back to the defaults
// the Phase 7 settings flow toggles (experiments, appearance) so the flow
// starts and ends from a known state on a shared backend. Env: SERVER_URL.
const headers = { "Content-Type": "application/json" };
const experiments = http.put(`${SERVER_URL}/api/v1/settings/experiments`, {
  headers,
  body: JSON.stringify({
    editMessages: true,
    mobileApp: false,
    newOnboarding: false,
    providerSessionReaping: false,
  }),
});
if (!experiments.ok) {
  throw new Error(`experiments reset failed: ${experiments.status}`);
}
const appearance = http.put(`${SERVER_URL}/api/v1/settings/appearance`, {
  headers,
  body: JSON.stringify({ themeId: "default", faviconColor: "default" }),
});
if (!appearance.ok) {
  throw new Error(`appearance reset failed: ${appearance.status}`);
}
