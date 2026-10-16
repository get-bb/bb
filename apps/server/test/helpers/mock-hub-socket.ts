interface MockHubSocket {
  bufferedAmount: number;
  closed: Array<{ code?: number; reason?: string }>;
  messages: string[];
  close(code?: number, reason?: string): void;
  send(data: string): void;
}

export function createMockHubSocket(): MockHubSocket {
  const messages: string[] = [];
  const closed: Array<{ code?: number; reason?: string }> = [];

  return {
    bufferedAmount: 0,
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
