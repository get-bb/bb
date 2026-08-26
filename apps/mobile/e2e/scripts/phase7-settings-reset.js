// Maestro runScript: put the harness server's settings back to the defaults
// the Phase 7 settings flow toggles (experiments, appearance) so the flow
// starts and ends from a known state on a shared backend. Env: SERVER_URL.
// The experiments body must name every key of @bb/domain `experimentKeys`
// (the schema is exhaustive); the values are `defaultExperiments`.
const headers = { "Content-Type": "application/json" };
const experiments = http.put(`${SERVER_URL}/api/v1/settings/experiments`, {
  headers,
  body: JSON.stringify({
    changelogPreview: false,
    editMessages: true,
    mobileApp: false,
    providerSessionReaping: false,
    timelineWindowing: false,
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
