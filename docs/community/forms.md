# Community forms

`/community/survey` is a site page with up to eleven required questions, depending on earlier answers, followed by required email. It uses the shared site navigation and footer, runs no analytics, and is `noindex, nofollow`. It doesn't appear in navigation or the sitemap. The page posts answers as JSON to `/api/community/survey`. Its form also declares `method="post"` to that route, so a submit before the page script loads never puts answers in a URL; the route rejects that non-JSON post.

## Configuration and launch

Collection defaults to off in both environments. `COMMUNITY_FORMS_ENABLED=true` enables survey submissions. Keep it off until the copy, data handling and exact build pass review. Apply the generated connect-db migrations before enabling collection.

Sticker claims need four Shopify settings. `COMMUNITY_SHOPIFY_STORE` (the `*.myshopify.com` host) and `COMMUNITY_STICKER_VARIANT_ID` (the numeric sticker-pack variant) are vars: empty in staging, set in production. `SHOPIFY_CLIENT_ID` and `SHOPIFY_CLIENT_SECRET` are Worker secrets from a Dev Dashboard app installed on the store with only the `write_discounts` scope; `deploy-web.yml` syncs them from GitHub secrets and skips them while they are empty. `COMMUNITY_STICKER_LIMIT` caps how many claims are reserved (1000). Until all four Shopify settings exist, finishers see “Sticker claims aren't open yet.” Nothing is loaded into the database. The Shopify secrets aren't in `secrets.required`, so deploys succeed before setup; for local QA, set them as vars, because local dev loads only the listed secrets from `.dev.vars`.

The shared review preview keeps collection off. Local synthetic QA may override these values against a fresh local D1 database; never use production bindings or real addresses for QA.

## Survey submission contract

POST `application/json` to `/api/community/survey` with `{ "submission_id": "<uuid>", "answers": { "<field>": ["<value>", ...] } }`. The page creates the UUID once per attempt, so a retried send is saved once. The question fields, in page order, are `discovery`, `role`, `work`, `company_size`, `love`, `improve`, `team_improve`, `team_adopt`, `community`, `city`, `meetup` and `research_call`; `survey.ts` owns their labels and choices. Questions are numbered in the browser, so hidden questions don't use a number.

Every visible question is required. Radio answers accept one listed choice. `community` is a checkbox that accepts one or more listed choices. `meetup` and `research_call` are radios. Text answers must not be blank.

`work` is hidden when `role` is “Student” or “Not currently working”, and so are the three questions that depend on it. `company_size` is shown for any `work` answer except “I don't use bb for work”. `team_improve` is shown for “2–5 people”, “6–10 people” and “More than 10”. `team_adopt` is shown for “Just me”. The page and server share these rules (`questionVisible` in `survey.ts`); a hidden question is never required and its answer is never sent or stored.

Q1 shuffles every choice except “I don't remember” and “Other”, which stay last in that order. The community question shuffles every choice except “Other”, which stays last. Other questions keep their listed order. Picking “Other” on `discovery`, `role` or `community` shows a “Please specify” text box below the choices; its `discovery_other`, `role_other` or `community_other` text is then required, and otherwise discarded. The meetup label names the city once one is typed.

`email` is required, accepts one valid address, and is stored with the answers in the private survey response. Text fields accept up to 250 characters. Removed questions and contact fields are rejected.

The page saves progress, including email, in `localStorage` under `bb-community-survey`, restores it on a later visit, and removes it once the answers are saved.

Requests must be JSON, which cross-site forms can't send without a CORS preflight the route never allows. A 16 KiB body limit (checked against `Content-Length` when sent, and counted in bytes while the body streams, which stops reading past the limit) and six submissions per minute per client apply; IPv4 clients are keyed by address and IPv6 clients by their /64 network. Unknown fields are rejected. Success returns `{ "result": { "duplicate", "claimLink", "claimNote" } }`. Validation returns HTTP 400 with `errors` by field, an unreadable body returns 400, collection-off or storage failure returns 503, and rate limiting returns 429, each with an `error` message. The page keeps the answers on screen after any failure.

## Gifts and sticker codes

The gift is two bb stickers, claimed through a Shopify store. Each claim gets its own Shopify discount, created when the claim is made: no code list is stored or loaded.

The save is one D1 batch: it checks whether the normalized email already has a claim, inserts the response, reserves a claim (`community_sticker_claim`, with a random `BB-` code of 12 base32 characters) only when the response is new, claims are configured, the email has no claim and fewer than `COMMUNITY_STICKER_LIMIT` claims exist, and records the email's SHA-256 in `community_survey_email` only when the claim was reserved. Email is compared lowercased and trimmed with any `+tag` removed. Someone who finishes while claims are closed or sold out can still claim later with the same email.

After the batch, the worker gets a client-credentials token and calls `discountCodeBasicCreate` (Admin GraphQL 2026-10) with the stored code: $3.00 off the sticker variant, usage limit 1, no combining, tagged `survey`, titled `Survey stickers – <first 8 characters of the submission ID>`. Each Shopify request times out after 5 seconds and refuses redirects. A duplicate-code error or an ambiguous failure is resolved by looking the code up with `codeDiscountNodeByCode`; the stored code is reused for every attempt, so retries never create a second discount. On success the claim becomes `created`; otherwise it stays `pending`. Pending claims are retried, and their links emailed, by the results-email layer; don't enable collection without it. `claims.ts` owns the whole claim: the save batch, the Shopify step and the messages.

`claimLink` is `https://<store>/cart/<variant>:1` with `discount=<code>` and `checkout[email]=<email>`, so checkout opens with the pack, the code applied, a $0 total and the email filled in. The thank-you view shows it once. `claimNote` is “We'll email you your sticker link shortly.” for a pending claim, “This email already has a sticker code. Thank you for answering again!” when the email already claimed, “We've given out all the stickers for now. Thank you for answering.” at the limit, and “Sticker claims aren't open yet. We'll post in Discord when they are.” without Shopify settings. A duplicate submission UUID cannot claim again.

The store must not accept payments, so a cart without a code or with more than one pack cannot be completed. Shopify keeps each order's name and mailing address; fulfill orders from Shopify admin and mark them fulfilled there. bb never stores addresses.

## Privacy

Survey responses contain a random submission ID, creation time and answers, including email. Email is used for stickers and results, never a marketing list. A claim links a response to its code through `submission_id` only until the claim is delivered or expires; the email hash holds no answers. Do not add request-body logging or analytics. Infrastructure may still handle request metadata; review logging before launch. IP addresses are used by the short-lived rate limiter, not stored with answers.

Choose a survey closing date and response-deletion date before launch. Delete raw survey responses when no longer needed and retain anonymous aggregate findings. Database backups can retain deleted survey answers under the provider's recovery policy.
