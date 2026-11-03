import type { Reply } from "./reply.js";
import { MACHINE_CREDENTIAL_HEADER, MACHINE_LABEL_PATH } from "./visitor.js";
export const MAX_MACHINE_LABEL_BODY_BYTES = 4096;

export interface MachineLabelProxy {
  assign(credential: string, body: Buffer): Promise<Reply>;
}

export function createMachineLabelProxy(options: {
  accountApiUrl: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}): MachineLabelProxy {
  const fetchImpl = options.fetch ?? fetch;
  return {
    async assign(credential, body) {
      const response = await fetchImpl(
        `${options.accountApiUrl}${MACHINE_LABEL_PATH}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [MACHINE_CREDENTIAL_HEADER]: credential,
          },
          body: new Uint8Array(body),
          signal: AbortSignal.timeout(options.timeoutMs ?? 10_000),
        },
      );
      const type = response.headers.get("content-type");
      return {
        status: response.status,
        headers: {
          "cache-control": "no-store",
          ...(type === null ? {} : { "content-type": type }),
        },
        body: Buffer.from(await response.arrayBuffer()),
      };
    },
  };
}
