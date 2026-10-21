import type { GitReadFailure } from "./read-contract.js";

export function gitReadFailureError(failure: GitReadFailure): Error {
  return "error" in failure
    ? Object.assign(new Error(failure.message), {
        body: failure.error,
        status: failure.status,
      })
    : Object.assign(new Error(failure.message), {
        body: failure,
        code: failure.code,
      });
}
