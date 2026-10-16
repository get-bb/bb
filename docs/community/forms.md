# Community forms

`/community/survey` and `/community/merch` serve standalone documents and accept URL-encoded POSTs on the same paths. They do not load the site analytics client, React hydration or external resources. Both use `noindex, nofollow`, `Cache-Control: no-store`, `Referrer-Policy: same-origin` and a restrictive Content Security Policy. Neither is added to site navigation or the sitemap. The survey confirmation does not link to the address form.

## Launch gate

Collection is off unless `COMMUNITY_FORMS_ENABLED=true`. Do not set it in production until the owner approves the copy, screenshots and data plan. Apply the generated connect-db migration before enabling collection. No Google Form is published or used by this implementation.

Local preview uses the same Worker and a local D1 database. Inject `COMMUNITY_FORMS_ENABLED="true"` and synthetic invitation codes through a local, untracked Cloudflare Vite configuration only while exercising synthetic submissions. The existing Wrangler secrets allowlist ignores undeclared `.dev.vars` entries. Keep the shared review preview in its default collection-off state.

## Storage and access

The existing private D1 database stores survey answers separately from shipping addresses. Each row also has a random submission ID and creation time. No email, phone, account ID, IP address, analytics ID or survey-to-address join is stored. The optional Discord answer exists only in survey responses.

There is no public response-reading endpoint. Read access is limited by the existing Cloudflare account and database/API credentials. Before launch, confirm which operators hold those permissions and name the shipping owner. Do not imply that database access is limited to one founder if other infrastructure operators have it.

A short-lived Cloudflare rate-limit counter uses the connection IP; it is not copied into response tables. Application code does not log request bodies or responses. Cloudflare still handles ordinary infrastructure request metadata. Check account-level logging settings before launch.

## Personal merch links

Configure `COMMUNITY_MERCH_INVITES` as a private Worker secret containing an object such as `{"a-random-recipient-code":{"hat":true}}`. Each founder DM uses `/community/merch?c=<code>`. Keep the code-to-recipient mapping in the private DM plan; it is not stored with addresses. Use unpredictable codes (for example 12 random bytes encoded as hex), not sequential codes. The code grants permission to submit, not to read any stored address.

Missing, unknown and revoked codes show an unavailable-link page. Hat eligibility comes from the server's invitation map; a URL flag cannot grant it. Non-hat recipients see only the name, shipping address and country fields. The response stores its code and stores `hat=null` when no hat was offered. Treat codes as private: they can appear in infrastructure URL logs, although the page sends no cross-origin referrer and loads no trackers. Remove a code from the secret after shipping to revoke further submissions.

## Shipping and deletion

The shipping owner reads the submitted fields and recipient code through the existing Cloudflare D1 console. Use the row ID to delete an address immediately after sending its package:

```sql
SELECT id, created_at, recipient_code, name, address, country, hat
FROM community_merch_address
ORDER BY created_at;

DELETE FROM community_merch_address WHERE id = '<the shipped row ID>';
```

Delete any downloaded/exported address copies too. Keep a separate sent list only if approved; never copy the address into it. Review unshipped addresses monthly and delete canceled requests. Deletion is manual, not an automatic expiration promise.

Survey responses remain private until the community planning work is complete. The owner must choose a closing date and deletion date before launch; retain anonymous aggregate findings instead of identifiable raw answers afterward.

D1 point-in-time backups can retain deleted data for up to 30 days on paid plans (7 days on free plans). A row deletion does not immediately remove those backups. If a database is restored, repeat any shipping deletions made after the restored point. See [Cloudflare Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

## Submission contract

POST `application/x-www-form-urlencoded` with the `submission_id` UUID from the form and its named fields. The `Origin` must match the form origin. A maximum of six submissions per minute per connection IP and a 16 KiB body limit apply. Unknown fields are rejected. Validation also runs on the server, including the three-pick cap and exclusive tool answers. Reposting the same submission ID does not add a duplicate row.

A valid saved submission returns a confirmation document. Invalid input returns HTTP 400 with preserved answers; collection-off and save failures return 503. A rejected origin returns 403 and rate limiting returns 429. Do not put personal information into URLs or CLI history when operating on real submissions.
