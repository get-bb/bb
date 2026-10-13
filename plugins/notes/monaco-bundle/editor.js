/**
 * The Monaco this plugin ships.
 *
 * `editor.main` is Monaco's own standalone-editor entry: the API plus its
 * contribution modules (find, folding, word navigation, sorting, suggest,
 * bracket matching, …) and the Monarch grammars.
 *
 * Importing `editor.api` alone would drop ~1.3 MB and also silently drop
 * every contribution, leaving an editor that opens and types but has no find
 * widget and no word navigation. Notes needs the Markdown grammar, and the
 * grammars arrive with the contributions, so this entry takes both. The
 * language *services* (completion and type checking for CSS, HTML, JSON and
 * TypeScript) stay out: Notes edits Markdown and has no language server.
 */
export * as monaco from "monaco-editor/editor/editor.api.js";
import "monaco-editor/editor/editor.main.js";
