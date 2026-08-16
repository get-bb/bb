// Node readline treats these valid JSON string characters as line endings.
const JSON_LINE_SEPARATOR = "\u2028";
const JSON_PARAGRAPH_SEPARATOR = "\u2029";

export function stringifyJsonRpcLine(message: unknown): string {
  const json = JSON.stringify(message);
  if (json === undefined) {
    throw new TypeError("JSON-RPC message is not serializable");
  }
  return json
    .replaceAll(JSON_LINE_SEPARATOR, "\\u2028")
    .replaceAll(JSON_PARAGRAPH_SEPARATOR, "\\u2029");
}
