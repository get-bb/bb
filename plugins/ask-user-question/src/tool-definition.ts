/**
 * The tool contract, transcribed from Claude Code's built-in `AskUserQuestion`
 * so a model that already knows the native tool behaves identically here.
 *
 * Two deliberate departures from the native definition, both forced by the fact
 * that BB delivers the answer as a tool *result* instead of rewriting the tool
 * call's input the way Claude Code's harness does:
 *
 * 1. The native input schema also carries `answers`, `annotations`, and
 *    `metadata`. Those are not model-authored — Claude Code's harness writes
 *    them back into the recorded call. Advertising them here would be
 *    accepted-but-ignored input that invites a model to invent its own answers,
 *    so they are omitted from the schema and returned in the result instead
 *    (see `ToolResult`, which reproduces their shape exactly).
 * 2. `multiSelect` is advertised as required-with-a-default exactly as Claude
 *    does, but validated leniently (see `toolQuestionSchema`).
 *
 * `questions` — the only branch a model actually authors — is verbatim.
 */

/**
 * Verbatim from Claude Code's `AskUserQuestion` tool description, in the form
 * it sends to current models: the main body, the "Reserve this for decisions…"
 * paragraph, and the markdown variant of the Preview block (Claude selects that
 * variant for its own monospace preview box; BB renders previews the same way,
 * so the HTML-fragment variant would describe the wrong format).
 *
 * One sentence is adapted rather than copied: Claude's says the UI "switches to
 * a side-by-side layout with a vertical option list on the left and preview on
 * the right". BB reveals the preview beneath the selected option instead, and
 * describing a layout the model cannot produce would be a lie in a paragraph
 * whose entire job is telling it what the preview will look like.
 */
export const TOOL_DESCRIPTION = `Use this tool only when you are blocked on a decision that is genuinely the user's to make: one you cannot resolve from the request, the code, or sensible defaults.

Usage notes:
- Users will always be able to select "Other" to provide custom text input
- Use multiSelect: true to allow multiple answers to be selected for a question
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label

Plan mode note: To switch into plan mode, use EnterPlanMode (not this tool). Once in plan mode, use this tool to clarify requirements or choose between approaches BEFORE finalizing your plan. Do NOT use this tool to ask "Is my plan ready?", "Should I proceed?", or otherwise reference "the plan" in questions — the user cannot see the plan until you call ExitPlanMode for approval.

Reserve this for decisions where the user's answer changes what you do next — not for choices with a conventional default or facts you can verify in the codebase yourself. In those cases pick the obvious option, mention it in your response, and proceed.

Preview feature:
Use the optional \`preview\` field on options when presenting concrete artifacts that users need to visually compare:
- ASCII mockups of UI layouts or components
- Code snippets showing different implementations
- Diagram variations
- Configuration examples

Preview content is rendered as markdown in a monospace box. Multi-line text with newlines is supported. The preview is revealed beneath an option once it is selected. Do not use previews for simple preference questions where labels and descriptions suffice. Note: previews are only supported for single-select questions (not multiSelect).
`;

/**
 * Claude's steering text for a question with fewer than two options, verbatim.
 * It is deliberately more than an error: it tells the model to stop asking and
 * proceed rather than to retry with a padded option list.
 */
export const TOO_FEW_OPTIONS_MESSAGE =
  "This call included a question with fewer than 2 options, so it was rejected and the person never saw it. A question with a single option has no decision in it. Do not retry this call and do not invent a filler second option. Instead, state the one path you were going to offer as the approach you are taking, then continue with the task. If this call also contained questions with 2 to 4 options (each with distinct labels), you may re-ask those questions alone in a new call. Ask a question only when the person has at least two genuinely distinct choices.";

/** Claude's uniqueness-refinement message, verbatim. */
export const NOT_UNIQUE_MESSAGE =
  "Question texts must be unique, option labels must be unique within each question";

/**
 * Claude's away-from-keyboard result, verbatim apart from the elapsed seconds
 * it interpolates.
 */
export function buildTimeoutMessage(elapsedMs: number): string {
  return `No response after ${Math.round(elapsedMs / 1000)}s — the user may be away from keyboard. Proceed using your best judgment based on the context so far; you can re-ask this question later if it's still relevant.`;
}

/**
 * Advertised to the provider verbatim (field order, prose, and constraints all
 * match Claude Code) rather than generated from zod, because the generated
 * schema cannot express `multiSelect` as required *and* defaulted. Execution
 * still validates against `toolInputSchema`; this only narrows it.
 */
export const TOOL_INPUT_JSON_SCHEMA: Record<string, unknown> = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  additionalProperties: false,
  properties: {
    questions: {
      description: "Questions to ask the user (1-4 questions)",
      items: {
        additionalProperties: false,
        properties: {
          question: {
            description:
              'The complete question to ask the user. Should be clear, specific, and end with a question mark. Example: "Which library should we use for date formatting?" If multiSelect is true, phrase it accordingly, e.g. "Which features do you want to enable?"',
            type: "string",
          },
          header: {
            description:
              'Very short label displayed as a chip/tag (max 12 chars). Examples: "Auth method", "Library", "Approach".',
            type: "string",
          },
          multiSelect: {
            default: false,
            description:
              "Set to true to allow the user to select multiple options instead of just one. Use when choices are not mutually exclusive.",
            type: "boolean",
          },
          options: {
            description:
              "The available choices for this question. Must have 2-4 options. Each option should be a distinct, mutually exclusive choice (unless multiSelect is enabled). There should be no 'Other' option, that will be provided automatically.",
            items: {
              additionalProperties: false,
              properties: {
                label: {
                  description:
                    "The display text for this option that the user will see and select. Should be concise (1-5 words) and clearly describe the choice.",
                  type: "string",
                },
                description: {
                  description:
                    "Explanation of what this option means or what will happen if chosen. Useful for providing context about trade-offs or implications.",
                  type: "string",
                },
                preview: {
                  description:
                    "Optional preview content rendered when this option is focused. Use for mockups, code snippets, or visual comparisons that help users compare options. See the tool description for the expected content format.",
                  type: "string",
                },
              },
              required: ["label", "description"],
              type: "object",
            },
            maxItems: 4,
            minItems: 2,
            type: "array",
          },
        },
        required: ["question", "header", "options", "multiSelect"],
        type: "object",
      },
      maxItems: 4,
      minItems: 1,
      type: "array",
    },
  },
  required: ["questions"],
  type: "object",
};
