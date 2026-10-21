/* MyTube content script: applies the switches and builds the hand-picked home feed. */
(function () {
  'use strict';

  var M = globalThis.MyTube;
  if (!M) return;

  var state = {
    settings: M.normalizeSettings(null),
    meta: {}
  };

  var feedSignature = '';
  var mountQueued = false;
  var tagQueued = false;
  var chromeQueued = false;
  var theater = { href: '', attempts: 0, lastClickAt: 0, done: false };
  var metaSaveTimer = null;
  var fetching = new Map();

  var VIEW_RE = /^(?:no views|[\d.,]+\s*[KMB](?:\s+views?)?|[\d.,]+\s+views?|[\d,]{1,7})$/i;
  var DATE_RE = new RegExp(
    '^(?:(?:streamed|premiered)\\s+)?(?:\\d+\\s*(?:mo|y|w|d|h|m)\\s+ago' +
      '|\\d+\\s+(?:second|minute|hour|day|week|month|year)s?\\s+ago)$' +
      '|^[A-Z][a-z]{2,8}\\s+\\d{1,2},\\s+\\d{4}$' +
      '|^\\d{1,2}\\s+[A-Z][a-z]{2,8}\\s+\\d{4}$' +
      '|^\\d{1,2}\\/\\d{1,2}\\/\\d{2,4}$',
    'i'
  );
  var META_SCOPE =
    '#metadata-line, ytd-video-meta-block, yt-content-metadata-view-model, ' +
    '.yt-content-metadata-view-model__metadata-row';
  var CARD_ROOTS =
    'yt-lockup-view-model, ytd-rich-item-renderer, ytd-video-renderer, ' +
    'ytd-compact-video-renderer, ytd-grid-video-renderer, ytd-playlist-video-renderer';

  boot();

  async function boot() {
    var [sync, local] = await Promise.all([
      chrome.storage.sync.get(M.SETTINGS_KEY).catch(function () {
        return {};
      }),
      chrome.storage.local.get(M.META_KEY).catch(function () {
        return {};
      })
    ]);

    state.settings = M.normalizeSettings(sync[M.SETTINGS_KEY]);
    state.meta = local[M.META_KEY] || {};

    applySettings();
    scheduleMount();
    scheduleTagging();
    scheduleChrome();
    watchForChanges();
  }

  function watchForChanges() {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'sync' && changes[M.SETTINGS_KEY]) {
        state.settings = M.normalizeSettings(changes[M.SETTINGS_KEY].newValue);
        applySettings();
        scheduleMount();
        scheduleTagging();
      }
      if (area === 'local' && changes[M.META_KEY]) {
        state.meta = changes[M.META_KEY].newValue || {};
        refreshRenderedCards();
      }
    });

    document.addEventListener('yt-navigate-start', handleNavigation, true);
    document.addEventListener('yt-navigate-finish', handleNavigation, true);
    window.addEventListener('popstate', handleNavigation);

    new MutationObserver(function () {
      scheduleMount();
      scheduleTagging();
      scheduleChrome();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function handleNavigation() {
    theater = { href: '', attempts: 0, lastClickAt: 0, done: false };
    applySettings();
    scheduleMount();
    scheduleTagging();
    scheduleChrome();
  }

  function shouldCustomizeHome() {
    return location.pathname === '/' && state.settings.videos.length > 0;
  }

  function applySettings() {
    var root = document.documentElement;
    var hidden = state.settings.hidden;

    Object.keys(hidden).forEach(function (key) {
      root.classList.toggle('mytube-hide-' + key, Boolean(hidden[key]));
    });
    root.classList.toggle('mytube-custom-home', shouldCustomizeHome());
    syncBrandText();

    if (hidden.shorts && location.pathname.indexOf('/shorts/') === 0) {
      location.replace('https://www.youtube.com/');
    }
  }

  /* ------------------------------------------------------------------ *
   * Static top-bar and watch-page layout
   * ------------------------------------------------------------------ */

  function scheduleChrome() {
    if (chromeQueued) return;
    chromeQueued = true;
    setTimeout(function () {
      chromeQueued = false;
      syncBrandText();
      ensureTheaterMode();
    }, 120);
  }

  function syncBrandText() {
    var start = document.querySelector('ytd-masthead #start');
    if (!start) return;

    var text = (state.settings.brandText || '').trim();
    var brand = start.querySelector('.mytube-brand-text');
    if (!brand) {
      brand = document.createElement('a');
      brand.className = 'mytube-brand-text';
      brand.href = '/';
    }

    var guide = start.querySelector('#guide-button');
    if (guide && guide.parentNode === start) {
      if (brand.previousElementSibling !== guide) {
        start.insertBefore(brand, guide.nextSibling);
      }
    } else if (brand.parentNode !== start) {
      start.insertBefore(brand, start.firstChild);
    }

    if (brand.textContent !== text) brand.textContent = text;
    brand.style.display = text ? '' : 'none';
    brand.setAttribute('aria-label', text ? text + ' home' : 'Home');
  }

  function isWatchPage() {
    return location.pathname === '/watch' || location.pathname.indexOf('/live/') === 0;
  }

  function ensureTheaterMode() {
    if (!isWatchPage()) return;

    if (theater.href !== location.href) {
      theater = { href: location.href, attempts: 0, lastClickAt: 0, done: false };
    }
    if (theater.done) return;

    var flexy = document.querySelector('ytd-watch-flexy');
    if (!flexy) return;
    if (flexy.hasAttribute('theater')) {
      theater.done = true;
      return;
    }
    if (theater.attempts >= 3 || Date.now() - theater.lastClickAt < 1500) return;

    var button = document.querySelector('.ytp-size-button');
    var label = button ? button.getAttribute('aria-label') || '' : '';
    if (!button || !/^Theater mode/i.test(label)) return;

    theater.attempts++;
    theater.lastClickAt = Date.now();
    button.click();
  }

  /* ------------------------------------------------------------------ *
   * Home feed
   * ------------------------------------------------------------------ */

  function scheduleMount() {
    if (mountQueued) return;
    mountQueued = true;
    setTimeout(function () {
      mountQueued = false;
      syncHome();
    }, 80);
  }

  function syncHome() {
    var wanted = shouldCustomizeHome();
    document.documentElement.classList.toggle('mytube-custom-home', wanted);

    var feed = document.getElementById('mytube-feed');
    if (!wanted) {
      if (feed) feed.remove();
      feedSignature = '';
      return;
    }

    var browse = document.querySelector('ytd-browse[page-subtype="home"]');
    if (!browse) return;

    var primary = browse.querySelector('#primary');
    if (!primary) return;

    if (!feed || !primary.contains(feed)) {
      if (feed) feed.remove();
      feed = document.createElement('div');
      feed.id = 'mytube-feed';
      primary.appendChild(feed);
      feedSignature = '';
    }

    var signature = state.settings.videos.join(',');
    if (signature !== feedSignature) {
      feedSignature = signature;
      feed.replaceChildren.apply(feed, state.settings.videos.map(buildCard));
      ensureMetadata(state.settings.videos);
    }
  }

  function buildCard(id) {
    var meta = state.meta[id] || {};

    var card = document.createElement('a');
    card.className = 'mytube-card';
    card.href = '/watch?v=' + encodeURIComponent(id);
    card.dataset.videoId = id;
    card.setAttribute('aria-label', meta.title || 'YouTube video');

    var thumb = document.createElement('div');
    thumb.className = 'mytube-thumb';

    var img = document.createElement('img');
    img.className = 'mytube-thumb-img';
    img.alt = '';
    img.loading = 'lazy';
    img.src = meta.thumb || 'https://i.ytimg.com/vi/' + id + '/maxresdefault.jpg';
    img.addEventListener(
      'error',
      function () {
        if (img.dataset.fallback) return;
        img.dataset.fallback = '1';
        img.src = 'https://i.ytimg.com/vi/' + id + '/hqdefault.jpg';
      },
      { once: true }
    );
    thumb.appendChild(img);

    var duration = document.createElement('span');
    duration.className = 'mytube-duration';
    duration.textContent = M.formatDuration(meta.duration);
    thumb.appendChild(duration);

    var info = document.createElement('div');
    info.className = 'mytube-info';

    var avatar = document.createElement('div');
    avatar.className = 'mytube-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    applyAvatar(avatar, meta);
    info.appendChild(avatar);

    var texts = document.createElement('div');
    texts.className = 'mytube-texts';

    var title = document.createElement('h3');
    title.className = 'mytube-title';
    title.textContent = meta.title || '';
    texts.appendChild(title);

    var metaLine = document.createElement('div');
    metaLine.className = 'mytube-meta';

    var byline = document.createElement('span');
    byline.className = 'mytube-byline';
    byline.textContent = meta.author || '';
    metaLine.appendChild(byline);

    var views = document.createElement('span');
    views.className = 'mytube-views';
    views.textContent = M.formatCompactViews(meta.views);
    views.title = M.formatViews(meta.views);
    metaLine.appendChild(views);

    var date = document.createElement('span');
    date.className = 'mytube-date';
    date.textContent = M.formatCompactDate(meta.published);
    metaLine.appendChild(date);

    texts.appendChild(metaLine);
    info.appendChild(texts);
    card.appendChild(thumb);
    card.appendChild(info);

    return card;
  }

  function applyAvatar(node, meta) {
    node.replaceChildren();
    var author = meta.author || '';
    node.style.background = author ? 'hsl(' + M.avatarHue(author) + ' 55% 42%)' : '';

    if (meta.avatar) {
      var img = document.createElement('img');
      img.className = 'mytube-avatar-img';
      img.alt = '';
      img.loading = 'lazy';
      img.src = meta.avatar;
      img.addEventListener('error', function () {
        img.remove();
        node.textContent = M.avatarLetter(author);
      });
      node.appendChild(img);
      return;
    }

    node.textContent = M.avatarLetter(author);
  }

  function updateCard(id) {
    var meta = state.meta[id];
    if (!meta) return;
    var card = document.querySelector('#mytube-feed .mytube-card[data-video-id="' + id + '"]');
    if (!card) return;

    card.setAttribute('aria-label', meta.title || 'YouTube video');
    var img = card.querySelector('.mytube-thumb-img');
    if (img && meta.thumb) {
      delete img.dataset.fallback;
      img.src = meta.thumb;
    }
    var duration = card.querySelector('.mytube-duration');
    if (duration) duration.textContent = M.formatDuration(meta.duration);
    var title = card.querySelector('.mytube-title');
    if (title) title.textContent = meta.title || '';
    var byline = card.querySelector('.mytube-byline');
    if (byline) byline.textContent = meta.author || '';
    var avatar = card.querySelector('.mytube-avatar');
    if (avatar) applyAvatar(avatar, meta);
    var views = card.querySelector('.mytube-views');
    if (views) {
      views.textContent = M.formatCompactViews(meta.views);
      views.title = M.formatViews(meta.views);
    }
    var date = card.querySelector('.mytube-date');
    if (date) date.textContent = M.formatCompactDate(meta.published);
  }

  function refreshRenderedCards() {
    if (!document.getElementById('mytube-feed')) return;
    state.settings.videos.forEach(updateCard);
  }

  /* ------------------------------------------------------------------ *
   * Metadata
   * ------------------------------------------------------------------ */

  function ensureMetadata(ids) {
    var now = Date.now();
    var missing = ids.filter(function (id) {
      var meta = state.meta[id];
      return !meta || meta.v !== M.META_VERSION || !meta.title || now - (meta.at || 0) > M.META_TTL_MS;
    });
    if (!missing.length) return;

    var cursor = 0;
    var workerCount = Math.min(3, missing.length);

    for (var i = 0; i < workerCount; i++) {
      runWorker();
    }

    async function runWorker() {
      while (cursor < missing.length) {
        var id = missing[cursor++];
        if (fetching.has(id)) {
          try {
            await fetching.get(id);
          } catch (error) {
            /* already handled by the other worker */
          }
          continue;
        }

        var task = fetchMetadata(id);
        fetching.set(id, task);
        try {
          var meta = await task;
          if (meta && meta.title) {
            state.meta[id] = Object.assign({}, meta, { at: Date.now(), v: M.META_VERSION });
            updateCard(id);
            scheduleMetaSave();
          }
        } catch (error) {
          /* keep the card usable with the thumbnail-only fallback */
        } finally {
          fetching.delete(id);
        }
      }
    }
  }

  async function fetchMetadata(id) {
    try {
      var meta = await fetchFromWatchPage(id);
      if (meta) return meta;
    } catch (error) {
      /* fall through to oEmbed */
    }
    return fetchFromOEmbed(id);
  }

  async function fetchFromWatchPage(id) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, 15000);

    try {
      var response = await fetch('https://www.youtube.com/watch?v=' + encodeURIComponent(id) + '&hl=en', {
        credentials: 'same-origin',
        signal: controller.signal
      });
      if (!response.ok) return null;
      var html = await response.text();
      return M.parseWatchPage(html);
    } finally {
      clearTimeout(timer);
    }
  }

  async function fetchFromOEmbed(id) {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, 10000);

    try {
      var target = 'https://www.youtube.com/watch?v=' + encodeURIComponent(id);
      var response = await fetch(
        'https://www.youtube.com/oembed?url=' + encodeURIComponent(target) + '&format=json',
        { credentials: 'same-origin', signal: controller.signal }
      );
      if (!response.ok) return null;
      var data = await response.json();
      return {
        id: id,
        title: data.title || '',
        author: data.author_name || '',
        views: null,
        published: '',
        duration: 0,
        thumb: data.thumbnail_url || ''
      };
    } finally {
      clearTimeout(timer);
    }
  }

  function scheduleMetaSave() {
    clearTimeout(metaSaveTimer);
    metaSaveTimer = setTimeout(function () {
      chrome.storage.local.set({ [M.META_KEY]: state.meta }).catch(function () {});
    }, 400);
  }

  /* ------------------------------------------------------------------ *
   * Tagging view counts and dates on YouTube's own cards
   * ------------------------------------------------------------------ */

  function scheduleTagging() {
    var hidden = state.settings.hidden;
    if (!hidden.channel && !hidden.views && !hidden.posted) return;
    if (tagQueued) return;
    tagQueued = true;
    setTimeout(function () {
      tagQueued = false;
      tagMetadataText();
      tagCardMetadata();
    }, 350);
  }

  function tagMetadataText() {
    var scopes = document.querySelectorAll(META_SCOPE);
    for (var s = 0; s < scopes.length; s++) {
      var leaves = scopes[s].querySelectorAll('span, div, yt-formatted-string');
      for (var i = 0; i < leaves.length; i++) {
        var leaf = leaves[i];
        if (leaf.childElementCount) continue;
        if (leaf.classList.contains('mytube-tag-views') || leaf.classList.contains('mytube-tag-date')) continue;

        var text = (leaf.textContent || '').trim();
        if (!text || text.length > 40) continue;

        if (VIEW_RE.test(text)) leaf.classList.add('mytube-tag-views');
        else if (DATE_RE.test(text)) leaf.classList.add('mytube-tag-date');
      }
    }
  }

  /**
   * YouTube's lockup cards do not use anchors for the channel name anymore.
   * The first metadata text in a lockup is the channel; the remaining ones are
   * the view count and date. Mark them (and their separators) so CSS can hide
   * each part independently.
   */
  function tagCardMetadata() {
    var roots = document.querySelectorAll(CARD_ROOTS);
    for (var i = 0; i < roots.length; i++) {
      var models = roots[i].querySelectorAll('yt-content-metadata-view-model');
      for (var m = 0; m < models.length; m++) {
        tagMetadataModel(models[m]);
      }
    }
  }

  function tagMetadataModel(model) {
    var rows = model.querySelectorAll('.ytContentMetadataViewModelMetadataRow');
    var sawChannel = false;

    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var texts = row.querySelectorAll('.ytContentMetadataViewModelMetadataText');

      for (var t = 0; t < texts.length; t++) {
        var el = texts[t];
        var text = (el.textContent || '').trim();
        if (!text) continue;

        if (VIEW_RE.test(text)) {
          el.classList.add('mytube-tag-views');
          tagSeparators(el, 'views');
        } else if (DATE_RE.test(text)) {
          el.classList.add('mytube-tag-date');
          tagSeparators(el, 'date');
        } else if (!sawChannel) {
          el.classList.add('mytube-tag-channel');
          sawChannel = true;
          tagChannelIcon(el);
        }
      }
    }

    for (var j = 0; j < rows.length; j++) {
      if (
        !rows[j].querySelector('.mytube-tag-channel') &&
        rows[j].querySelector('.mytube-tag-views, .mytube-tag-date')
      ) {
        rows[j].classList.add('mytube-tag-extra-row');
      }
    }
  }

  function tagSeparators(el, kind) {
    var prev = el.previousElementSibling;
    var next = el.nextElementSibling;

    if (
      prev &&
      (prev.classList.contains('ytContentMetadataViewModelDelimiter') ||
        prev.classList.contains('ytIconWrapperHost'))
    ) {
      prev.classList.add('mytube-delim-' + kind);
    }
    if (next && next.classList.contains('ytContentMetadataViewModelDelimiter')) {
      next.classList.add('mytube-delim-' + kind);
    }
  }

  function tagChannelIcon(el) {
    var next = el.nextElementSibling;
    while (next && next.classList.contains('ytIconWrapperHost')) {
      next.classList.add('mytube-delim-channel');
      next = next.nextElementSibling;
    }
  }
})();
