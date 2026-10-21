# MyTube

MyTube is a small Chrome extension (Manifest V3) that replaces YouTube's home
recommendation feed with a list of videos you choose, and hides the parts of
YouTube you would rather not see.

No build step and no server. Load the folder unpacked in Chrome and it runs.

## What it does

**Your home page, your videos.** Paste YouTube links in the toolbar popup and
those videos become the home feed. Cards use the real thumbnail, title,
duration, channel avatar, channel name, view count, and publish date, laid out
four per row.

**Hide the noise.** Each switch works across YouTube and takes effect
immediately in open tabs:

- Comments
- Shorts (also sends `/shorts/` links to the home page)
- Channel name and avatar
- Posted date
- View count
- Filter chips (including the search filter bar)
- Left sidebar
- Top bar, including search
- Video top row (channel, subscribe, and like buttons)
- Video middle row
- Video bottom row (description)

**A quieter interface, always on.** These changes are not switches:

- The top bar drops the YouTube logo, the microphone, and the entire right-side
  control group (Create, Notifications, profile, settings, and sign-in). A text
  brand (set in the popup, "MyTube" by default) takes the logo's place.
- The search box moves to the right side, gets narrower, and loses its
  magnifier button. Pressing Enter still searches.
- Home always shows four videos per row.
- Watch pages start in theater mode, put the related list below the comments,
  and hide live broadcasts from that list.

YouTube's normal home page is left alone until you add at least one video.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder.
4. Optionally pin MyTube to the toolbar.
5. Open or reload YouTube.

## Use

Open the MyTube popup:

- Paste links into the box, one per line (spaces and commas also work), and
  press **Add**.
  Supported forms include `youtube.com/watch?v=…`, `youtu.be/…`,
  `youtube.com/shorts/…`, `/live/…`, `/embed/…`, `music.youtube.com`, and bare
  11-character video IDs.
- Remove a video with the **×** next to it.
- Set the top-bar brand text under **Top bar**.
- Flip switches under **Hide on YouTube**. Changes are saved automatically.

The custom feed appears on the YouTube home page. Watch pages use the static
stacked layout described above, with the enabled elements hidden. Search and
channel pages keep their normal layout, with the enabled elements hidden.

## Data and privacy

Everything stays in Chrome:

- Video list and switches: `chrome.storage.sync`.
- Video metadata cache (title, thumbnail, channel, views, date, duration):
  `chrome.storage.local`. Entries are considered stale after 24 hours and are
  refreshed the next time the home feed is built.

To fill in the cards, the content script requests public YouTube watch pages
(same-origin) and falls back to YouTube's oEmbed endpoint. Thumbnails and
avatars are loaded from YouTube's image CDNs. Requests go to YouTube/Google
only; there is no analytics, tracking, or third-party service.

## How it works

- `src/shared.js` — pure helpers: URL parsing, settings normalization,
  watch-page parsing, formatting.
- `src/content.js` — injects `#mytube-feed` into
  `ytd-browse[page-subtype="home"] #primary`, fetches and caches metadata,
  handles SPA navigation and Shorts redirects, tags YouTube's own
  channel/views/date spans, renders the top-bar brand, and enters theater mode
  on watch pages.
- `src/content.css` — the feed grid and card styling, the static top-bar /
  watch-page layout, and the `html.mytube-hide-*` selectors behind each switch.
- `src/popup.*` — the toolbar control panel.

While the custom feed is active, YouTube's own home grid, chips, Shorts shelf,
and continuations are hidden. YouTube's 2026 card metadata no longer uses links
for the channel name, so the content script marks the first metadata span in
each lockup as the channel and tags view/date spans and their separators. That
lets each switch hide only its own piece without leaving stray bullet points.

## Development

Run the tests (Node 18+):

```sh
node --test
```

Regenerate the PNG icons (Python 3, standard library only):

```sh
python3 tools/make-icons.py
```

There is no bundler; edit the files and reload the extension in
`chrome://extensions`.

## Limitations

- YouTube changes its DOM regularly. The selectors were written against the
  desktop site in October 2026 and may need updating after a redesign.
- The channel switch targets video cards and the watch page owner. Comment
  authors, channel-page headers, and channel results in search keep their
  names. The watch page keeps the subscriber count and Subscribe button.
- On watch pages, the related list sits below the comments as a four-column
  grid; its channel, views, and date are hidden along with the same information
  on other cards.
- Live broadcasts are removed from the related list. Live chat (on streams) is
  not affected.
- A regular (non-Shorts) video opened through a `/shorts/` URL is redirected by
  YouTube itself to `/watch`, so MyTube cannot turn that one into a home-page
  redirect. Real Shorts links are redirected.
- Metadata can be up to 24 hours old because of the cache. If YouTube blocks a
  metadata request, the card falls back to its thumbnail and any cached data.
- Comments hiding covers the comment section, not live chat.

MyTube is not affiliated with YouTube or Google.
