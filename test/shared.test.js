'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const M = require('../src/shared.js');

const ID = 'dQw4w9WgXcQ';

test('parseVideoId accepts every common YouTube link shape', () => {
  const cases = [
    ID,
    `https://www.youtube.com/watch?v=${ID}`,
    `https://www.youtube.com/watch?v=${ID}&t=42s`,
    `http://youtube.com/watch?v=${ID}`,
    `https://m.youtube.com/watch?v=${ID}`,
    `https://music.youtube.com/watch?v=${ID}`,
    `https://youtu.be/${ID}`,
    `https://youtu.be/${ID}?si=abc123`,
    `https://www.youtube.com/shorts/${ID}`,
    `https://www.youtube.com/live/${ID}`,
    `https://www.youtube.com/embed/${ID}`,
    `https://www.youtube-nocookie.com/embed/${ID}`,
    `youtube.com/watch?v=${ID}`
  ];

  for (const input of cases) {
    assert.equal(M.parseVideoId(input), ID, input);
  }
});

test('parseVideoId rejects non-video input', () => {
  const cases = [
    '',
    '   ',
    'hello',
    'https://vimeo.com/12345',
    'https://www.youtube.com/playlist?list=PL1234567890',
    'https://www.youtube.com/@somechannel',
    'https://www.youtube.com/watch?v=short',
    'https://youtu.be/',
    'PL1234567890abcdef'
  ];

  for (const input of cases) {
    assert.equal(M.parseVideoId(input), null, input);
  }
});

test('normalizeSettings dedupes videos and fills defaults', () => {
  const settings = M.normalizeSettings({
    videos: [ID, `https://youtu.be/${ID}`, 'bad', 'M7lc1UVf-VE'],
    hidden: { comments: true, wat: true }
  });

  assert.deepEqual(settings.videos, [ID, 'M7lc1UVf-VE']);
  assert.equal(settings.brandText, 'MyTube');
  assert.equal(settings.hidden.comments, true);
  assert.equal(settings.hidden.shorts, false);
  assert.equal(settings.hidden['watch-top-row'], false);
  assert.equal('wat' in settings.hidden, false);
});

test('normalizeSettings survives missing or broken data', () => {
  for (const input of [undefined, null, 'nope', 42, {}]) {
    const settings = M.normalizeSettings(input);
    assert.deepEqual(settings.videos, []);
    assert.equal(settings.brandText, 'MyTube');
    assert.deepEqual(settings.hidden, M.DEFAULT_SETTINGS.hidden);
  }
});

test('normalizeSettings keeps an editable, bounded brand text', () => {
  assert.equal(M.normalizeSettings({ brandText: 'My Channel' }).brandText, 'My Channel');
  assert.equal(M.normalizeSettings({ brandText: '' }).brandText, '');
  assert.equal(M.normalizeSettings({ brandText: 42 }).brandText, 'MyTube');
  assert.equal(M.normalizeSettings({ brandText: 'x'.repeat(80) }).brandText.length, 40);
});

test('extractJsonAfter handles braces and escapes inside strings', () => {
  const source = `noise; var ytInitialPlayerResponse = {"a":"brace } inside","b":{"c":"quote \\" here"}}; after`;
  assert.deepEqual(M.extractJsonAfter(source, 'ytInitialPlayerResponse'), {
    a: 'brace } inside',
    b: { c: 'quote " here' }
  });
});

test('parseWatchPage reads the player payload', () => {
  const payload = {
    videoDetails: {
      videoId: ID,
      title: 'A "quoted" title',
      author: 'Casey',
      viewCount: '1234567',
      lengthSeconds: '212',
      thumbnail: {
        thumbnails: [
          { url: 'https://i.ytimg.com/vi/x/hqdefault.jpg' },
          { url: '//i.ytimg.com/vi/x/maxresdefault.jpg' }
        ]
      }
    },
    microformat: {
      playerMicroformatRenderer: {
        publishDate: '2023-05-01T00:00:00-07:00',
        ownerChannelName: 'Casey'
      }
    }
  };

  const meta = M.parseWatchPage(
    `<script>var ytInitialPlayerResponse = ${JSON.stringify(payload)};</script>`
  );

  assert.deepEqual(meta, {
    id: ID,
    title: 'A "quoted" title',
    author: 'Casey',
    views: 1234567,
    published: '2023-05-01T00:00:00-07:00',
    duration: 212,
    thumb: 'https://i.ytimg.com/vi/x/maxresdefault.jpg',
    avatar: ''
  });
});

test('parseWatchPage extracts the owner avatar from initial data', () => {
  const player = {
    videoDetails: {
      videoId: ID,
      title: 'Title',
      author: 'Casey',
      viewCount: '10',
      lengthSeconds: '60',
      thumbnail: { thumbnails: [{ url: 'https://i.ytimg.com/vi/x/hq.jpg' }] }
    }
  };
  const initial = {
    contents: {
      twoColumnWatchNextResults: {
        results: {
          results: {
            contents: [
              {},
              {
                videoSecondaryInfoRenderer: {
                  owner: {
                    videoOwnerRenderer: {
                      thumbnail: {
                        thumbnails: [
                          { url: 'https://yt3.ggpht.com/small=s48' },
                          { url: 'https://yt3.ggpht.com/big=s176' }
                        ]
                      }
                    }
                  }
                }
              }
            ]
          }
        }
      }
    }
  };

  const html =
    `<script>var ytInitialPlayerResponse = ${JSON.stringify(player)};</script>` +
    `<script>var ytInitialData = ${JSON.stringify(initial)};</script>`;

  assert.equal(M.parseWatchPage(html).avatar, 'https://yt3.ggpht.com/big=s176');
});

test('formatCompactViews matches the current YouTube byline', () => {
  assert.equal(M.formatCompactViews(null), '');
  assert.equal(M.formatCompactViews(0), 'No views');
  assert.equal(M.formatCompactViews(1), '1 view');
  assert.equal(M.formatCompactViews(999), '999');
  assert.equal(M.formatCompactViews(1200), '1.2K');
  assert.equal(M.formatCompactViews(22000000), '22M');
});

test('formatCompactDate matches the current YouTube byline', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');

  assert.equal(M.formatCompactDate('2026-10-21T11:59:30Z', now), 'just now');
  assert.equal(M.formatCompactDate('2026-10-21T11:30:00Z', now), '30m ago');
  assert.equal(M.formatCompactDate('2026-10-21T06:00:00Z', now), '6h ago');
  assert.equal(M.formatCompactDate('2026-10-19T12:00:00Z', now), '2d ago');
  assert.equal(M.formatCompactDate('2026-07-21T12:00:00Z', now), '3mo ago');
  assert.equal(M.formatCompactDate('2009-10-25T12:00:00Z', now), '17y ago');
  assert.equal(M.formatCompactDate('nonsense', now), '');
});

test('parseWatchPage returns null for pages without a player payload', () => {
  assert.equal(M.parseWatchPage('<html>consent</html>'), null);
  assert.equal(M.parseWatchPage(''), null);
  assert.equal(
    M.parseWatchPage('var ytInitialPlayerResponse = {"videoDetails":{"videoId":"nope"}};'),
    null
  );
});

test('formatViews matches YouTube-style labels', () => {
  assert.equal(M.formatViews(null), '');
  assert.equal(M.formatViews(0), 'No views');
  assert.equal(M.formatViews(1), '1 view');
  assert.equal(M.formatViews(999), '999 views');
  assert.equal(M.formatViews(1000), '1K views');
  assert.equal(M.formatViews(1200), '1.2K views');
  assert.equal(M.formatViews(1234567), '1.2M views');
});

test('formatDuration matches the thumbnail badge', () => {
  assert.equal(M.formatDuration(0), '');
  assert.equal(M.formatDuration(-5), '');
  assert.equal(M.formatDuration(59), '0:59');
  assert.equal(M.formatDuration(212), '3:32');
  assert.equal(M.formatDuration(3600), '1:00:00');
  assert.equal(M.formatDuration(7325), '2:02:05');
});

test('formatRelativeDate matches YouTube-style labels', () => {
  const now = Date.parse('2026-10-21T12:00:00Z');

  assert.equal(M.formatRelativeDate('2026-10-21T11:59:30Z', now), 'just now');
  assert.equal(M.formatRelativeDate('2026-10-21T11:55:00Z', now), '5 minutes ago');
  assert.equal(M.formatRelativeDate('2026-10-20T12:00:00Z', now), '1 day ago');
  assert.equal(M.formatRelativeDate('2026-10-01T12:00:00Z', now), '2 weeks ago');
  assert.equal(M.formatRelativeDate('2025-10-21T12:00:00Z', now), '1 year ago');
  assert.equal(M.formatRelativeDate('nonsense', now), '');
});

test('avatar helpers are stable and safe', () => {
  assert.equal(M.avatarLetter('Casey'), 'C');
  assert.equal(M.avatarLetter('  Зоригоо'), 'З');
  assert.equal(M.avatarLetter(''), '');
  assert.equal(M.avatarLetter('123'), '1');
  assert.equal(M.avatarHue('Casey'), M.avatarHue('Casey'));
  assert.ok(M.avatarHue('Casey') >= 0 && M.avatarHue('Casey') < 360);
});
