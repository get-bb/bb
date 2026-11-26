const action = STUB_ACTION;
const base =
  typeof STUB_CONTROL_URL === "string" && STUB_CONTROL_URL.length > 0
    ? STUB_CONTROL_URL
    : "http://127.0.0.1:42997";
function control(path, method) {
  const url = `${base}/__stub/${path}`;
  const response =
    method === "GET"
      ? http.get(url)
      : http.post(url, {
          headers: { "content-type": "application/json" },
          body: "{}",
        });
  if (!response.ok) {
    throw new Error(
      `connect stub ${path} failed: HTTP ${response.status} ${response.body}`,
    );
  }
  return JSON.parse(response.body);
}

if (action === "expire-session") {
  const { sessions } = control("state", "GET");
  const { expired } = control(action, "POST");
  if (!Number.isInteger(expired) || expired < 1) {
    throw new Error(`connect stub expired no sessions (expired=${expired})`);
  }
  output.sessionExpiry = {
    sessionCount: sessions.length,
    machineIds: sessions
      .filter((session) => session.invalidatedAt === null)
      .map((session) => session.machineId),
  };
} else if (action === "assert-session-renewed") {
  const { sessionCount, machineIds } = output.sessionExpiry;
  const { sessions } = control("state", "GET");
  const replacement = sessions
    .slice(sessionCount)
    .find(
      (session) =>
        session.invalidatedAt === null &&
        machineIds.includes(session.machineId),
    );
  if (!replacement) {
    throw new Error(
      "connect stub minted no replacement session for an expired machine",
    );
  }
} else {
  control(action, "POST");
}
