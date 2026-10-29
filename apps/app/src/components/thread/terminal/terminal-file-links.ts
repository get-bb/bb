import type { ILinkProvider, IBufferRange, Terminal } from "@xterm/xterm";
import {
  isAbsoluteHostPath,
  joinHostPath,
  normalizeHostPath,
} from "@bb/domain";
import type { ExperimentalFileOpenOptions } from "@get-bb/plugin-sdk";
import { isTerminalLinkActivation } from "./terminal-links";

export function createTerminalFileLinkProvider({
  terminal,
  getCwd,
  hostId,
  openFile,
}: {
  terminal: Terminal;
  getCwd: () => string;
  hostId: string;
  openFile: (intent: ExperimentalFileOpenOptions) => void;
}): ILinkProvider {
  return {
    provideLinks(lineNumber, callback) {
      const buffer = terminal.buffer.active;
      let start = lineNumber - 1;
      while (start > 0 && buffer.getLine(start)?.isWrapped) start--;
      let text = "";
      const positions: Array<{ x: number; y: number }> = [];
      for (let row = start; row < buffer.length; row++) {
        const line = buffer.getLine(row);
        if (!line) break;
        const wrapped = buffer.getLine(row + 1)?.isWrapped === true;
        const length = wrapped
          ? line.length
          : line.translateToString(true).length;
        let used = 0;
        for (let col = 0; col < line.length; col++) {
          const cell = line.getCell(col);
          if (!cell || cell.getWidth() === 0) continue;
          const chars = cell.getChars() || " ";
          if (!wrapped && used >= length) break;
          for (let index = 0; index < chars.length; index++)
            positions.push({ x: col + 1, y: row + 1 });
          text += chars;
          used += chars.length;
        }
        if (!wrapped) break;
      }
      const links = [];
      const pattern =
        /"[^"\r\n]+"(?::\d+){0,2}|'[^'\r\n]+'(?::\d+){0,2}|[^\s"'`<>()[\]{}]+/gu;
      for (const match of text.matchAll(pattern)) {
        const raw = match[0].replace(/[.,;:!?]+$/u, "");
        if (raw.length > 32_768 || /^[a-z][a-z\d+.-]*:\/\//iu.test(raw))
          continue;
        const parsed = /^(.*?)(?::(\d+))?(?::(\d+))?$/u.exec(raw);
        if (!parsed) continue;
        const path = parsed[1]!.replace(/^("|')|("|')$/gu, "");
        if (
          !/[\\/]/u.test(path) &&
          !/^[\w.-]+\.[\w-]+$/u.test(path) &&
          !parsed[2]
        )
          continue;
        if (
          path.startsWith("~") ||
          (/^[a-z][a-z\d+.-]*:/iu.test(path) && !/^[a-z]:[\\/]/iu.test(path))
        )
          continue;
        const resolved = isAbsoluteHostPath(path)
          ? normalizeHostPath(path)
          : joinHostPath({ rootPath: getCwd(), relativePath: path });
        if (!resolved) continue;
        const line = parsed[2] === undefined ? null : Number(parsed[2]);
        const column = parsed[3] === undefined ? null : Number(parsed[3]);
        if (
          (line !== null && (!Number.isSafeInteger(line) || line < 1)) ||
          (column !== null && (!Number.isSafeInteger(column) || column < 1))
        )
          continue;
        const first = positions[match.index];
        const last = positions[match.index + raw.length - 1];
        if (!first || !last || lineNumber < first.y || lineNumber > last.y)
          continue;
        const range: IBufferRange = { start: first, end: last };
        links.push({
          text: raw,
          range,
          activate: (event: MouseEvent) => {
            if (!isTerminalLinkActivation(event)) return;
            openFile({
              target: { kind: "host", hostId, path: resolved },
              location: line === null ? null : { kind: "line", line, column },
            });
          },
        });
      }
      callback(links);
    },
  };
}

export function parseTerminalReportedCwd(data: string): string | null {
  try {
    const url = new URL(data);
    if (url.protocol !== "file:") return null;
    return decodeURIComponent(url.pathname).replace(/^\/([A-Za-z]:\/)/u, "$1");
  } catch {
    return null;
  }
}
