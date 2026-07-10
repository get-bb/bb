import type {
  BbDesktopServerListEntry,
  BbDesktopServerSource,
  BbDesktopServerStatus,
} from "@bb/desktop-contract";

export interface DesktopRailServerTile {
  active: boolean;
  id: string;
  initial: string;
  name: string;
  source: BbDesktopServerSource;
  status: BbDesktopServerStatus;
}

export interface DesktopRailViewModel {
  servers: DesktopRailServerTile[];
}

export function serverTileInitial(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "?";
  }
  // Prefer the first letter/number code point for multi-server glyphs.
  const match = trimmed.match(/\p{L}|\p{N}/u);
  if (match === null) {
    return trimmed.slice(0, 1).toUpperCase();
  }
  return match[0].toUpperCase();
}

export function buildDesktopRailViewModel(args: {
  servers: BbDesktopServerListEntry[];
}): DesktopRailViewModel {
  return {
    servers: args.servers.map((server) => ({
      active: server.active,
      id: server.id,
      initial: serverTileInitial(server.name),
      name: server.name,
      source: server.source,
      status: server.status,
    })),
  };
}
