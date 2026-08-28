import { jsonValueSchema, type JsonValue } from "@bb/domain";

export async function readJson(response: Response): Promise<JsonValue> {
  return jsonValueSchema.parse(await response.json());
}
