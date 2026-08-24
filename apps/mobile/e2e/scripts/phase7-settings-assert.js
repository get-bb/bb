// Maestro runScript: read the server-persisted settings the Phase 7 flow
// changed through the UI and fail unless they landed. Env: SERVER_URL,
// EXPECT_NEW_ONBOARDING ("true" | "false"), EXPECT_THEME_ID.
const config = json(http.get(`${SERVER_URL}/api/v1/system/config`).body);
const newOnboarding = String(config.experiments.newOnboarding);
if (newOnboarding !== EXPECT_NEW_ONBOARDING) {
  throw new Error(
    `experiments.newOnboarding is ${newOnboarding}, expected ${EXPECT_NEW_ONBOARDING}`,
  );
}
if (config.appearance.themeId !== EXPECT_THEME_ID) {
  throw new Error(
    `appearance.themeId is ${config.appearance.themeId}, expected ${EXPECT_THEME_ID}`,
  );
}
