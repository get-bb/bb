# Building and sending in Resend

Read this when building the draft in Resend, checking it, sharing a screenshot
or sending.

## How to work with Resend

Ask the user how they work with Resend and check their setup before starting.
Each step below says what must be true when it's done, whichever way it's done.

## Build the draft

1. **Host the images.** Upload the logo and every graphic to Resend so each has
   a hosted URL, then map the URLs to the local files by checksum (Resend drops
   file names). `hosted-map.mjs` writes `hosted.json` and keeps saved URLs it
   can't reach:

   ```sh
   node scripts/monthly-email/hosted-map.mjs scripts/monthly-email/issues/<yyyy-mm> <urls…>
   ```

   In the dashboard, images are uploaded into a broadcast draft. Keep that
   draft, renamed "Image uploads · {Month} {Year} email (keep)": deleting it
   might delete the hosted images. After a review round, upload only the images
   whose hosted copy is out of date; rendering below names them.

2. **Render the send HTML:**

   ```sh
   node scripts/monthly-email/render-email.mjs scripts/monthly-email/issues/<yyyy-mm>.json --hosted scripts/monthly-email/issues/<yyyy-mm>/hosted.json --out scripts/monthly-email/issues/<yyyy-mm>.send.html
   ```

   Rendering with `--hosted` refuses any image whose hosted copy no longer
   matches the local file.

3. **Import the HTML** into a new broadcast so it becomes editable blocks,
   keeping text, links, images and the unsubscribe placeholder. In the dashboard
   that's "Upload HTML" in an empty draft.
4. **Page style:** body centered, body width 592 px, page padding 0. The email's
   own 16 px side padding sits inside the body, so 592 gives the 560 px column.
5. **Header fields**, after the import, because importing renames the draft:
   From, Reply-To, Subject, Preview text, and the name "What's new in bb ·
   {Month} {Year}". The body has no hidden preheader of its own: Resend builds
   one from the Preview text field, and a second would repeat the line.
6. **Check the build.** Save the draft's HTML as `issues/<yyyy-mm>.resend.html`
   and its header fields as `issues/<yyyy-mm>.resend-fields.json` (`from`,
   `replyTo`, `subject`, `preview`, `name`), then compare them with the send
   HTML and the spec:

   ```sh
   node scripts/monthly-email/check-resend.mjs scripts/monthly-email/issues/<yyyy-mm>.send.html scripts/monthly-email/issues/<yyyy-mm>.resend.html scripts/monthly-email/issues/<yyyy-mm>.json scripts/monthly-email/issues/<yyyy-mm>.resend-fields.json
   ```

   All twelve lines must say ok, including "send HTML matches the spec", which
   catches a send HTML that wasn't re-rendered after an edit. When the visible
   text differs, it prints the first difference.

7. **Old drafts:** delete earlier drafts of the issue, never the image-upload
   draft. Leave To empty until the send.

## Screenshot for sharing

Render Resend's built HTML full length, 680 px wide at 2×, in a browser that has
the system fonts the email falls back to, such as a desktop browser. Check every
section before sharing it.

## Sending

- **Tracking first:** open and click tracking are on for mail.getbb.app in
  Resend, and the test email's links carry `utm_campaign=monthly_releases_<ym>`
  and show up in getbb.app's analytics.
- **Audience:** everyone subscribed, once each. A Resend broadcast goes to
  exactly one segment, and segments are fixed lists, so the To field is one
  segment that combines every list the reviewer names. Unsubscribes are honored.
- **Update the segment before scheduling and again right before the send.** The
  website signup list keeps growing, but the combined segment only changes when
  someone adds contacts to it, and the send usually comes days after scheduling.
  Do the update below before scheduling, and arrange for it to run again within
  the hour before the send (by hand, or with an automation that has Resend
  access then). To update:
  1. Add every contact on each list the reviewer names to the combined segment.
     Re-adding a contact is harmless. In the dashboard's contact view, select
     each page and use bulk Edit → Add to segments; its pages can skip contacts
     that share an import time, so re-check every row's segment tags afterwards.
  2. Check that the combined segment's count equals the lists' union (each
     list's count, minus contacts on more than one list). Don't schedule until
     it does.
  3. Set the draft's To to the combined segment and confirm it's still set after
     a reload.

  Never re-import contacts by CSV, which can re-subscribe people who
  unsubscribed.

- **Test emails** go out only when the reviewer says, to the recipients they
  name. Check every link in the received email.
- **Schedule** after the reviewer's go-ahead on the test email: the first
  Thursday after the month ends, 16:00 UTC, unless they pick otherwise.
- **Changes after scheduling** need the reviewer's go-ahead. Unschedule, edit,
  then extract the draft to confirm only the intended text changed. Schedule it
  again, check the contacts, time and links on the way, and confirm the
  broadcast shows as scheduled. Test emails still work while scheduled.
