/**
 * The prompt prefixes that seed the composer when the user asks bb to create
 * one of its own resources. Every entry point for a kind — library button,
 * settings button, composer menu — uses the same prefix, so the instruction the
 * agent reads does not drift between surfaces.
 */

export const CREATE_SKILL_PROMPT = "Create a new bb skill that ";
export const CREATE_AUTOMATION_PROMPT = "Create a new bb automation to ";
export const CREATE_PLUGIN_PROMPT = "Create a new bb plugin that ";
