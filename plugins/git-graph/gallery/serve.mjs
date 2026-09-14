import { createServer } from "node:http";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const galleryDir = path.dirname(fileURLToPath(import.meta.url));
const d3Bundle = path.resolve(galleryDir, "../node_modules/d3/dist/d3.js");
const port = Number(process.env.GALLERY_PORT ?? 4183);

const CONTENT_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".mjs", "text/javascript; charset=utf-8"],
  [".svg", "image/svg+xml"],
  [".json", "application/json; charset=utf-8"],
]);

function sendFile(res, filePath) {
  const stream = createReadStream(filePath);
  stream.on("error", () => {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  });
  res.writeHead(200, {
    "content-type":
      CONTENT_TYPES.get(path.extname(filePath)) ?? "application/octet-stream",
    "cache-control": "no-store",
  });
  stream.pipe(res);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${port}`);
  if (url.pathname === "/vendor/d3.js") {
    sendFile(res, d3Bundle);
    return;
  }
  const relative = url.pathname === "/" ? "/index.html" : url.pathname;
  const target = path.resolve(galleryDir, `.${relative}`);
  if (!target.startsWith(galleryDir)) {
    res.writeHead(403, { "content-type": "text/plain" });
    res.end("forbidden");
    return;
  }
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error("not a file");
    sendFile(res, target);
  } catch {
    res.writeHead(404, { "content-type": "text/plain" });
    res.end("not found");
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`git-graph gallery: http://127.0.0.1:${port}/`);
});
