# Community forms

`/api/community/survey` accepts a survey of up to twelve required questions, depending on earlier answers, followed by required email, and stores the answers.

## Configuration and launch

Collection defaults to off in both environments. `COMMUNITY_FORMS_ENABLED=true` enables survey submissions. Keep it off until the copy, data handling and exact build pass review. Apply the generated connect-db migrations before enabling collection.

The shared review preview keeps collection off. Local synthetic QA may override these values against a fresh local D1 database; never use production bindings or real addresses for QA.

## Survey submission contract

POST `application/json` to `/api/community/survey` with `{ "submission_id": "<uuid>", "answers": { "<field>": ["<value>", ...] } }`. A retried send with the same UUID is saved once. The question fields, in survey order, are `discovery`, `role`, `work`, `company_size`, `love`, `improve`, `team_improve`, `team_adopt`, `plugin_sharing`, `community`, `city`, `meetup` and `research_call`; `survey.ts` owns their labels and choices.

Every visible question is required. Radio answers accept one listed choice. `community` and `plugin_sharing` are checkboxes that accept one or more listed choices. `meetup` and `research_call` are radios. Text answers must not be blank.

`work` is hidden when `role` is “Student” or “Not currently working”, and so are the four questions that depend on it. `company_size` is shown for any `work` answer except “I don't use bb for work”. `team_improve` and `plugin_sharing` are shown for “2–5 people”, “6–10 people” and “More than 10”. `team_adopt` is shown for “Just me”. `questionVisible` in `survey.ts` owns these rules; a hidden question is never required and its answer is never stored.

Picking “Other” on `discovery`, `role` or `community` requires its `discovery_other`, `role_other` or `community_other` text; otherwise that text is discarded.

`email` is required, accepts one valid address, and is stored with the answers in the private survey response. Text fields accept up to 250 characters. Removed questions and contact fields are rejected.

Requests must be JSON, which cross-site forms can't send without a CORS preflight the route never allows. A 16 KiB body limit (checked against `Content-Length` when sent, and counted in bytes while the body streams, which stops reading past the limit) and six submissions per minute per client apply; IPv4 clients are keyed by address and IPv6 clients by their /64 network. Unknown fields are rejected. Success returns `{ "result": { "duplicate": false } }`. Validation returns HTTP 400 with `errors` by field, an unreadable body returns 400, collection-off or storage failure returns 503, and rate limiting returns 429, each with an `error` message.

## Privacy

Survey responses contain a random submission ID, creation time and answers, including email. Email is used for stickers and results, never a marketing list. Do not add request-body logging, analytics, or a join between these datasets. Infrastructure may still handle request metadata; review logging before launch. IP addresses are used by the short-lived rate limiter, not stored with answers.

Choose a survey closing date and response-deletion date before launch. Delete raw survey responses when no longer needed and retain anonymous aggregate findings. Database backups can retain deleted survey answers under the provider's recovery policy.
