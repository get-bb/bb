import type { HonoRequest } from "hono";
import { ApiError } from "../errors.js";

export async function readMultipartFormData(
  request: HonoRequest,
): Promise<FormData> {
  try {
    return await request.formData();
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
    throw new ApiError(
      400,
      "invalid_request",
      "Request body is not valid multipart form data",
    );
  }
}
