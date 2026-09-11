import { copyFile, mkdir } from "node:fs/promises";

const root = new URL("../", import.meta.url);
await mkdir(new URL("dist/", root), { recursive: true });
await copyFile(new URL("Dockerfile", root), new URL("dist/Dockerfile", root));
