# Building and sending in Resend

Read this when building the draft in Resend, checking it, sharing a screenshot
or sending.

## Browser

Use the bb desktop app's browser, signed in to the Resend team that sends from
mail.getbb.app; no API key is needed. `bb machine list` gives each machine's
host ID, and `bb browser instances --host <host>` lists the desktop browser on
it. Open a session:

```sh
bb browser-automation open --backend desktop --machine <host> --desktop <instance>
```

Limits:

- A desktop session lasts 30 minutes.
- A run fails after about 30 seconds in practice, even with a longer
  `--timeout`, and a failed run ends the session.
- A script is at most 128,000 characters.
- One browser message holds about 1 MB, so the generated scripts upload at most
  four images per run and refuse any graphic over 700 KB.

Files the browser writes are on its machine; read them with
`bb file read <path> --host <host> --json`.

## Build the draft

Serve `scripts/monthly-email/issues/<yyyy-mm>/` at a URL the browser can reach
(`share-server-links`), and use that URL as the preview base. Then write the
step scripts:

```sh
node scripts/monthly-email/browser-scripts.mjs resend scripts/monthly-email/issues/<yyyy-mm>.json scripts/monthly-email/browser --preview-base <preview URL>
```

Regenerating removes step scripts that no longer apply. Run each step, in order,
with:

```sh
bb browser-automation run <session> --timeout 28s --script-file scripts/monthly-email/browser/<step>.js --script-host <this host> --json
```

1. **Host the images** (`1-upload-images.js`, then each
   `1-upload-images-part<n>-into-open-draft.js`): creates a broadcast and
   uploads the logo and every graphic. Pass all the returned URLs to
   `hosted-map.mjs`, which writes `hosted.json` by checksum (Resend drops file
   names) and keeps saved URLs it can't reach:

   ```sh
   node scripts/monthly-email/hosted-map.mjs scripts/monthly-email/issues/<yyyy-mm> <urls…>
   ```

   Keep that draft, renamed "Image uploads · {Month} {Year} email (keep)":
   deleting it might delete the hosted images. After a review round, open that
   draft and run the `1b-upload-changed-images-into-open-draft` scripts, which
   upload only the images whose hosted copy is out of date.

2. **Render the send HTML**, then regenerate the step scripts so the upload
   carries it:

   ```sh
   node scripts/monthly-email/render-email.mjs scripts/monthly-email/issues/<yyyy-mm>.json --hosted scripts/monthly-email/issues/<yyyy-mm>/hosted.json --out scripts/monthly-email/issues/<yyyy-mm>.send.html
   ```

   Rendering with `--hosted` refuses any image whose hosted copy no longer
   matches the local file.

3. **Upload HTML** (`2-upload-html.js`): "Upload HTML" in an empty draft
   converts the email into editor blocks, keeping text, links, images and the
   unsubscribe placeholder. If the run times out after creating the draft, run
   `2b-upload-html-into-open-draft.js`. Code → "Edit HTML" (raw mode) doesn't
   unlock through automation.
4. **Page style** (`3-page-style.js`): Body centered, Body width 592 px, page
   padding 0. The email's own 16 px side padding sits inside the body, so 592
   gives the 560 px column.
5. **Header fields** (`4-fields.js`), after the upload, because uploading
   renames the draft: From, Reply-To (typed slowly; fast typing keeps one
   letter), Subject, Preview text, and the name "What's new in bb · {Month}
   {Year}". The body has no hidden preheader of its own: Resend builds one from
   the Preview text field, and a second would repeat the line.
6. **Check the build.** Save the draft with `5-extract.js`, then compare it with
   the send HTML, the spec and the header fields:

   ```sh
   bb browser-automation run <session> --timeout 28s --script-file scripts/monthly-email/browser/5-extract.js --script-host <this host> --json | node scripts/monthly-email/browser-scripts.mjs save-extract scripts/monthly-email/issues/<yyyy-mm>
   node scripts/monthly-email/check-resend.mjs scripts/monthly-email/issues/<yyyy-mm>.send.html scripts/monthly-email/issues/<yyyy-mm>.resend.html scripts/monthly-email/issues/<yyyy-mm>.json scripts/monthly-email/issues/<yyyy-mm>.resend-fields.json
   ```

   All twelve lines must say ok, including "send HTML matches the spec", which
   catches a send HTML that wasn't re-rendered after an edit. When the visible
   text differs, it prints the first difference.

7. **Old drafts:** delete earlier drafts of the issue (More actions → Delete
   broadcast, then type its name), never the image-upload draft. Leave To empty
   until the send.

## Screenshot for sharing

Render Resend's built HTML full length in the bb desktop app's browser, which
has the system fonts the email falls back to. Write the script, run it in a
desktop session, and copy the PNG back:

```sh
node scripts/monthly-email/browser-scripts.mjs slack-shot scripts/monthly-email/issues/<yyyy-mm>.resend.html /tmp/bb-email-<month>-<year>.png > scripts/monthly-email/browser/slack.js
```

It's 680 px wide at 2×. Check every section before sharing it.

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
  Do the update below before scheduling. When you schedule, also set up a bb
  automation that repeats it within the hour before the send. The automation
  needs the bb desktop app open and signed in to Resend at that time; if it
  won't be, do the update by hand in that hour. To update:
  1. In the dashboard's contact view, open each list in turn and add every
     contact to the combined segment: select the page, then bulk Edit → Add to
     segments. Re-adding a contact is harmless.
  2. The contact view's pages can skip contacts that share an import time, so
     afterwards re-check every row's segment tags and add any that were missed.
  3. Open the combined segment and check that its count equals the lists' union
     (each list's count, minus contacts on more than one list). Don't schedule
     until it does.
  4. Set the draft's To to the combined segment and confirm it's still set after
     a reload.

  Never re-import contacts by CSV, which can re-subscribe people who
  unsubscribed.

- **Test emails** go out only when the reviewer says, to the recipients they
  name. Test email takes addresses separated by commas or line breaks. Check
  every link in the received email.
- **Schedule** after the reviewer's go-ahead on the test email: the first
  Thursday after the month ends, 16:00 UTC, unless they pick otherwise.
- **Changes after scheduling** need the reviewer's go-ahead. Test email still
  works while scheduled, but editing needs "Unschedule to make changes". Edit,
  reload and extract to confirm only the intended text changed, then set When
  again, check Review (contacts, time, links) and slide to schedule. Confirm the
  broadcast list shows Scheduled.
