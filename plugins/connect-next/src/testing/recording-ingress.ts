import type { OpenTunnelIngress } from "../ingress.js";

export function recordingIngress(baseUrl: () => string) {
  const opened: string[] = [];
  let closed = 0;
  let open = 0;
  const openIngress: OpenTunnelIngress = async ({ audience }) => {
    opened.push(audience);
    open += 1;
    let isClosed = false;
    return {
      baseUrl: baseUrl(),
      async close() {
        if (isClosed) return;
        isClosed = true;
        open -= 1;
        closed += 1;
      },
    };
  };
  return {
    openIngress,
    opened,
    get closed() {
      return closed;
    },
    get open() {
      return open;
    },
  };
}
