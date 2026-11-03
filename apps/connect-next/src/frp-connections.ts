import type { Duplex } from "node:stream";

interface FrpConnection {
  sockets: Duplex[];
  label: string | null;
  goodbye: (() => void) | null;
}

export interface FrpConnections {
  websocketOrigin(): string;
  track(clientAddress: string, sockets: Duplex[], goodbye?: () => void): void;
  loggedIn(clientAddress: string, label: string): void;
  close(label: string): number;
  closeAll(): number;
  count(label: string): number;
}

export function createFrpConnections(): FrpConnections {
  let next = 0;
  const open = new Map<string, FrpConnection>();

  function end(connection: FrpConnection): void {
    if (connection.goodbye !== null) {
      connection.goodbye();
      return;
    }
    for (const socket of connection.sockets) socket.destroy();
  }

  function matching(label: string): [string, FrpConnection][] {
    return [...open].filter(([, connection]) => connection.label === label);
  }

  return {
    websocketOrigin() {
      next += 1;
      return `http://frpc-${next}.gate.invalid`;
    },
    track(clientAddress, sockets, goodbye) {
      const connection: FrpConnection = {
        sockets,
        label: null,
        goodbye: goodbye ?? null,
      };
      open.set(clientAddress, connection);
      for (const socket of sockets) {
        socket.once("close", () => {
          if (open.get(clientAddress) === connection)
            open.delete(clientAddress);
        });
      }
    },
    loggedIn(clientAddress, label) {
      const connection = open.get(clientAddress);
      if (connection !== undefined) connection.label = label;
    },
    close(label) {
      const found = matching(label);
      for (const [clientAddress, connection] of found) {
        open.delete(clientAddress);
        end(connection);
      }
      return found.length;
    },
    closeAll() {
      const all = [...open.values()];
      open.clear();
      for (const connection of all) end(connection);
      return all.length;
    },
    count: (label) => matching(label).length,
  };
}
