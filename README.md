# MyTube

MyTube is a small Chrome extension (Manifest V3) that replaces YouTube's home
recommendation feed with a list of videos you choose, and hides the parts of
YouTube you would rather not see.

No build step and no server. Load the folder unpacked in Chrome and it runs.

## What it does

**Your home page, your videos.** Paste YouTube links in the toolbar popup and
those videos become the home feed. Cards use the real thumbnail, title,
duration, channel avatar, channel name, view count, and publish date. Card
width, gap, and thumbnail corner radius are adjustable in the popup.

**A page that looks the way you want.** Set a global font family, font size, and
text color. Add a fixed background image with an adjustable dim color and
opacity, or apply a free-form CSS filter to the whole page, including text,
panels, thumbnails, and the background. The background image can be an
`https://` URL or a local file chosen in the popup.

**Hide the noise.** Each switch works across YouTube and takes effect
immediately in open tabs:

- Comments
- Shorts (also sends `/shorts/` links to the home page)
- Channel name and avatar
- Posted date
- View count
- Filter chips (including the search filter bar)
- Left sidebar (and its top-bar menu button)
- Top bar, including search
- Video top row (channel, subscribe, and like buttons)
- Video middle row
- Video bottom row (description)

**A quieter interface, always on.** These changes are not switches:

- The top bar is transparent and drops the YouTube logo, the microphone, and
  the entire right-side control group (Create, Notifications, profile,
  settings, and sign-in). A text brand (set in the popup, "MyTube" by default)
  takes the logo's place.
- The search box moves to the right side at half its previous width, loses its
  magnifier button, and has no background, border, or focus ring. Pressing
  Enter still searches.
- Video titles written with Unicode mathematical "font" characters are
  normalized to plain text, so the selected global font actually applies.
- Watch pages start in theater mode, put the related list below the comments in
  a three-column grid, and hide live broadcasts from that list.
- Watch pages start under a translucent dark layer. The video player stays
  clear and interactive; click anywhere else to reveal the page.

YouTube's normal home page is left alone until you add at least one video.

## Install

1. Open `chrome://extensions`.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and choose this folder.
4. Optionally pin MyTube to the toolbar.
5. Open or reload YouTube.

## Use

Open the MyTube popup. The controls are grouped into collapsible sections;
click a section title to open or close it.

- Under **Your videos**, paste links into the box, one per line (spaces and
  commas also work), and press **Add**. Supported forms include
  `youtube.com/watch?v=…`, `youtu.be/…`, `youtube.com/shorts/…`, `/live/…`,
  `/embed/…`, `music.youtube.com`, and bare 11-character video IDs.
- Remove a video with the **×** next to it.
- Set the top-bar brand text under **Layout → Top bar**.
- Set **Thumbnail corner radius**, **Video card width**, and **Gap between
  cards** under **Layout → Cards**. Corner radius applies to every video
  thumbnail; width sets the home-feed column width, and gap applies to the home
  feed and related grid. Changes are saved automatically.
- Set the theme under **Theme**: font family, font size, text color,
  background image, dim color and opacity, and a CSS filter. Font family is a
  dropdown of installed fonts plus generic families. `0` keeps YouTube's own
  text sizes. The filter is applied to the whole page through a full-screen,
  click-through overlay. Use the local image picker for files on your computer;
  **Remove background** clears both the URL and the local image.
- Flip switches under **Hide on YouTube**. Changes are saved automatically.

The custom feed appears on the YouTube home page. Watch pages use the static
stacked layout described above, with the enabled elements hidden. Search and
channel pages keep their normal layout, with the enabled elements hidden.

## Data and privacy

Everything stays in Chrome:

- Video list, switches, and global style settings: `chrome.storage.sync`.
- Video metadata cache (title, thumbnail, channel, views, date, duration):
  `chrome.storage.local`. Entries are considered stale after 24 hours and are
  refreshed the next time the home feed is built.
- A local background image: `chrome.storage.local`. The picker resizes it to at
  most 2560 px on the long side and stores a compressed WebP data URL. It is
  never uploaded.
- Installed font names: read on demand with Chrome's `fontSettings` API to fill
  the font dropdown. They are not stored or sent anywhere.

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
  channel/views/date spans, renders the top-bar brand, applies card and global
  style variables, applies the background image/dim layer and CSS filter,
  enters theater mode, and manages the watch-page dimmer.
- `src/content.css` — the feed grid and card styling, global typography and
  background styling, the static top-bar / watch-page layout, and the
  `html.mytube-hide-*` selectors behind each switch.
- `src/popup.*` — the toolbar control panel, including background-image
  selection and compression.

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
- On watch pages, the related list sits below the comments as a three-column
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
- Chrome blocks `file://` images on YouTube pages. Use the local image picker
  instead; it stores a compressed copy of the selected image in extension
  storage.
- Global font size and text color override every text element instead of
  preserving YouTube's heading/body hierarchy. This is intentional, but very
  large sizes or low-contrast colors can make parts of the interface hard to
  use.
- CSS filters are applied by a full-screen, `pointer-events: none` backdrop
  overlay, so they affect thumbnails, panels, and the background image without
  blocking clicks. Expensive filters can reduce scrolling or video performance.

MyTube is not affiliated with YouTube or Google.
