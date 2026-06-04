/**
 * Minimal in-memory socket satisfying the hub's structural `HubSocket`
 * contract. Records sent payloads and close calls so tests assert delivered
 * messages instead of call sequences.
 */
export interface MockHubSocket {
  closed: Array<{ code?: number; reason?: string }>;
  messages: string[];
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export function createMockHubSocket(): MockHubSocket {
  const messages: string[] = [];
  const closed: Array<{ code?: number; reason?: string }> = [];

  return {
    closed,
    messages,
    close(code?: number, reason?: string) {
      closed.push({ code, reason });
    },
    send(data: string) {
      messages.push(data);
    },
  };
}
