// Maestro runScript: read the server-persisted settings the Phase 7 flow
// changed through the UI and fail unless they landed. Env: SERVER_URL,
// EXPECT_EDIT_MESSAGES ("true" | "false"), EXPECT_THEME_ID.
const config = json(http.get(`${SERVER_URL}/api/v1/system/config`).body);
const editMessages = String(config.experiments.editMessages);
if (editMessages !== EXPECT_EDIT_MESSAGES) {
  throw new Error(
    `experiments.editMessages is ${editMessages}, expected ${EXPECT_EDIT_MESSAGES}`,
  );
}
if (config.appearance.themeId !== EXPECT_THEME_ID) {
  throw new Error(
    `appearance.themeId is ${config.appearance.themeId}, expected ${EXPECT_THEME_ID}`,
  );
}
