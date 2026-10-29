declare module "cross-spawn/lib/parse.js" {
  import type { SpawnOptions } from "node:child_process";
  export default function parse(
    command: string,
    args: string[],
    options: SpawnOptions,
  ): {
    command: string;
    args: string[];
    options: SpawnOptions;
  };
}
