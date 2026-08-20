// Maestro runScript: the harness has exactly one host (the in-process
// daemon). Export its id and name for the machines part of the flow, and
// when RESTORE_NAME is set, rename it back to that name. Env: SERVER_URL,
// RESTORE_NAME (optional).
const hosts = json(http.get(`${SERVER_URL}/api/v1/hosts`).body);
const host = hosts[0];
if (!host) {
  throw new Error("The harness reported no hosts");
}
if (typeof RESTORE_NAME === "string" && RESTORE_NAME.length > 0) {
  const response = http.request(`${SERVER_URL}/api/v1/hosts/${host.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: RESTORE_NAME }),
  });
  if (!response.ok) {
    throw new Error(`rename back failed: ${response.status} ${response.body}`);
  }
}
output.hostId = host.id;
output.hostName = host.name;
