const response = http.post(`http://127.0.0.1:42996/${SCENARIO}`, { body: "" });
if (!response.ok) {
  throw new Error(`Simulator push failed: ${response.status} ${response.body}`);
}
