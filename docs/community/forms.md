# Community forms

`/community/survey` is a site page with up to eleven required questions, depending on earlier answers, followed by required email. It uses the shared site navigation and footer, runs no analytics, and is `noindex, nofollow`. It doesn't appear in navigation or the sitemap. The page posts answers as JSON to `/api/community/survey`. Its form also declares `method="post"` to that route, so a submit before the page script loads never puts answers in a URL; the route rejects that non-JSON post.

## Configuration and launch

Collection defaults to off in both environments. `COMMUNITY_FORMS_ENABLED=true` enables survey submissions. Keep it off until the copy, data handling and exact build pass review. Apply the generated connect-db migrations before enabling collection.

`COMMUNITY_STICKER_CLAIM_URL` is empty in staging and set to the store's sticker-pack cart permalink in production. Before enabling collection, load the unused Shopify codes with `INSERT INTO community_gift_code (code) VALUES (...)` through `wrangler d1 execute DB --remote --file <codes.sql>`, keeping the SQL file outside the repository, and leave out any code already used in a test order.

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

The gift is two bb stickers, claimed through a Shopify store. `COMMUNITY_STICKER_CLAIM_URL` is the store's cart permalink for one sticker pack, for example `https://<store>.myshopify.com/cart/<variant_id>:1`. While it is empty, finishers see “Sticker claims aren't open yet.” instead of a link.

`community_gift_code` holds one-time Shopify discount codes that each make one pack free. The codes are generated in Shopify and loaded into the production database out of band; never commit them. A successful survey save atomically marks one random unclaimed code as claimed, at most one per email. Email is compared lowercased and trimmed with any `+tag` removed; a repeat email saves its answers and gets “This email already has a sticker code.” as `claimNote`. `community_survey_email` keeps only a SHA-256 of that normalized email. When no unclaimed code remains, `claimNote` is “We've given out all the stickers for now. Thank you for answering.” A duplicate submission UUID cannot claim another code.

`claimLink` is the claim URL with `discount=<code>` and `checkout[email]=<email>`, so checkout opens with the pack, the code applied, a $0 total and the email filled in. The thank-you view shows it once.

The store must not accept payments, so a cart without a code or with more than one pack cannot be completed. Shopify keeps each order's name and mailing address; fulfill orders from Shopify admin and mark them fulfilled there. bb never stores addresses.

## Privacy

Survey responses contain a random submission ID, creation time and answers, including email. Email is used for stickers and results, never a marketing list. `community_gift_code` contains only a code and a claimed flag: no survey ID, answer, contact detail or timestamp. Do not add request-body logging, analytics, or a join between these datasets. Infrastructure may still handle request metadata; review logging before launch. IP addresses are used by the short-lived rate limiter, not stored with answers.

Choose a survey closing date and response-deletion date before launch. Delete raw survey responses when no longer needed and retain anonymous aggregate findings. Database backups can retain deleted survey answers under the provider's recovery policy.
