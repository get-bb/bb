/**
 * The extensions this plugin claims as a file opener, and their Monaco
 * language ids.
 *
 * Claiming an extension makes Monaco the *default* viewer for it the moment
 * the plugin is installed: BB picks the first registration matching an
 * extension whenever the user has no per-extension preference. Users opt back
 * out one extension at a time under Settings → File openers, and that
 * settings page renders one row per distinct claimed extension — so this list
 * is deliberately "common text and code" rather than exhaustive.
 *
 * Two kinds of file can never reach us regardless of what is listed here:
 * binaries we deliberately leave out (png, pdf, zip — BB's preview renders
 * them properly), and files BB reads as having no extension at all, which
 * includes dotfiles: its `getFileExtension` returns null when the last dot is
 * at index 0 or absent, so `Makefile`, `LICENSE`, and `.gitignore` always use
 * the built-in preview.
 *
 * Extensions must be lowercase alphanumerics with no dot — the SDK rejects
 * the registration otherwise.
 */
const LANGUAGE_BY_EXTENSION: Record<string, string> = {
  // Web
  js: "javascript",
  jsx: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  ts: "typescript",
  tsx: "typescript",
  mts: "typescript",
  cts: "typescript",
  html: "html",
  htm: "html",
  css: "css",
  scss: "scss",
  less: "less",
  vue: "html",
  svelte: "html",

  // Data and config
  json: "json",
  jsonc: "json",
  yaml: "yaml",
  yml: "yaml",
  toml: "ini",
  ini: "ini",
  cfg: "ini",
  conf: "ini",
  env: "shell",
  xml: "xml",
  csv: "plaintext",
  tsv: "plaintext",

  // Docs
  md: "markdown",
  mdx: "markdown",
  markdown: "markdown",
  txt: "plaintext",
  text: "plaintext",
  rst: "plaintext",
  adoc: "plaintext",

  // Systems
  c: "c",
  h: "c",
  cc: "cpp",
  cpp: "cpp",
  cxx: "cpp",
  hpp: "cpp",
  hh: "cpp",
  rs: "rust",
  go: "go",
  zig: "plaintext",
  swift: "swift",
  m: "objective-c",
  mm: "objective-c",

  // JVM / .NET
  java: "java",
  kt: "kotlin",
  kts: "kotlin",
  scala: "scala",
  groovy: "plaintext",
  cs: "csharp",
  fs: "fsharp",

  // Scripting
  py: "python",
  pyi: "python",
  rb: "ruby",
  php: "php",
  pl: "perl",
  lua: "lua",
  r: "r",
  sh: "shell",
  bash: "shell",
  zsh: "shell",
  fish: "shell",
  ps1: "powershell",
  bat: "bat",
  cmd: "bat",

  // Query and schema
  sql: "sql",
  graphql: "graphql",
  gql: "graphql",
  proto: "plaintext",

  // Infra
  tf: "hcl",
  tfvars: "hcl",
  hcl: "hcl",
  dockerfile: "dockerfile",

  // Other
  dart: "dart",
  ex: "plaintext",
  exs: "plaintext",
  erl: "plaintext",
  clj: "clojure",
  hs: "plaintext",
  jl: "julia",
  patch: "plaintext",
  diff: "plaintext",
  log: "plaintext",
};

/** Every extension this plugin claims, for `app.slots.fileOpener`. */
export const CLAIMED_EXTENSIONS: readonly string[] =
  Object.keys(LANGUAGE_BY_EXTENSION);

/** The Monaco language id for a path, defaulting to plaintext. */
export function languageForPath(path: string): string {
  const name = path.split("/").at(-1) ?? path;
  const dotIndex = name.lastIndexOf(".");
  if (dotIndex <= 0 || dotIndex === name.length - 1) return "plaintext";
  const extension = name.slice(dotIndex + 1).toLowerCase();
  return LANGUAGE_BY_EXTENSION[extension] ?? "plaintext";
}
