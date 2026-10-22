/* MyTube content script: applies the switches and builds the hand-picked home feed. */
(function () {
  'use strict';

  var M = globalThis.MyTube;
  if (!M) return;

  var state = {
    settings: M.normalizeSettings(null),
    meta: {},
    background: null
  };

  var feedSignature = '';
  var mountQueued = false;
  var tagQueued = false;
  var titleQueued = false;
  var chromeQueued = false;
  var watchDimQueued = false;
  var watchDimPlayer = null;
  var watchDimObserver = null;
  var theater = { href: '', attempts: 0, lastClickAt: 0, done: false };
  var watchDim = { href: '', dismissed: false };
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
  var TITLE_SCOPE =
    'ytd-watch-metadata h1, ytd-video-primary-info-renderer h1, ' +
    '[id="video-title"], [id="video-title-link"], ' +
    '.yt-lockup-metadata-view-model__title, ' +
    '.yt-lockup-metadata-view-model-wiz__title, ' +
    '.ytLockupMetadataViewModelTitle, ' +
    '#mytube-feed .mytube-title';

  boot();

  async function boot() {
    var [sync, local] = await Promise.all([
      chrome.storage.sync.get(M.SETTINGS_KEY).catch(function () {
        return {};
      }),
      chrome.storage.local.get([M.META_KEY, M.BACKGROUND_KEY]).catch(function () {
        return {};
      })
    ]);

    state.settings = M.normalizeSettings(sync[M.SETTINGS_KEY]);
    state.meta = local[M.META_KEY] || {};
    state.background = local[M.BACKGROUND_KEY] || null;

    applySettings();
    scheduleMount();
    scheduleTagging();
    scheduleTitleNormalization();
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
      if (area === 'local' && changes[M.BACKGROUND_KEY]) {
        state.background = changes[M.BACKGROUND_KEY].newValue || null;
        applyBackground();
      }
    });

    document.addEventListener('yt-navigate-start', handleNavigation, true);
    document.addEventListener('yt-navigate-finish', handleNavigation, true);
    window.addEventListener('popstate', handleNavigation);
    window.addEventListener('scroll', scheduleWatchDimLayout, { passive: true });
    window.addEventListener('resize', scheduleWatchDimLayout);
    document.addEventListener('fullscreenchange', scheduleWatchDimLayout, true);
    if (typeof ResizeObserver === 'function') {
      watchDimObserver = new ResizeObserver(scheduleWatchDimLayout);
    }

    new MutationObserver(function () {
      scheduleMount();
      scheduleTagging();
      scheduleTitleNormalization();
      scheduleChrome();
    }).observe(document.documentElement, { childList: true, subtree: true });
  }

  function handleNavigation() {
    theater = { href: '', attempts: 0, lastClickAt: 0, done: false };
    watchDim = { href: '', dismissed: false };
    applySettings();
    scheduleMount();
    scheduleTagging();
    scheduleTitleNormalization();
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
    root.style.setProperty('--mytube-thumb-radius', state.settings.thumbnailRadius + 'px');
    root.style.setProperty('--mytube-card-size', state.settings.cardSize + 'px');
    root.style.setProperty('--mytube-card-gap', state.settings.cardGap + 'px');
    applyGlobalStyle();
    applyBackground();
    syncBrandText();

    if (hidden.shorts && location.pathname.indexOf('/shorts/') === 0) {
      location.replace('https://www.youtube.com/');
    }
  }

  function applyGlobalStyle() {
    var root = document.documentElement;
    var settings = state.settings;

    var fontFamily = settings.fontFamily || '';
    root.classList.toggle('mytube-custom-font', Boolean(fontFamily));
    if (fontFamily) root.style.setProperty('--mytube-font-family', fontFamily);
    else root.style.removeProperty('--mytube-font-family');

    var fontSize = settings.fontSize;
    root.classList.toggle('mytube-custom-font-size', fontSize > 0);
    if (fontSize > 0) root.style.setProperty('--mytube-font-size', fontSize + 'px');
    else root.style.removeProperty('--mytube-font-size');

    var textColor = settings.textColor || '';
    root.classList.toggle('mytube-custom-text-color', Boolean(textColor));
    if (textColor) root.style.setProperty('--mytube-text-color', textColor);
    else root.style.removeProperty('--mytube-text-color');

    var filter = settings.cssFilter || '';
    root.classList.toggle('mytube-has-filter', Boolean(filter));
    if (filter) root.style.setProperty('--mytube-css-filter', filter);
    else root.style.removeProperty('--mytube-css-filter');
    root.style.removeProperty('filter');
  }

  function applyBackground() {
    var root = document.documentElement;
    var url = state.settings.backgroundUrl || '';
    if (!/^(https?:\/\/|data:image\/)/i.test(url)) url = '';
    var localImage = state.background && state.background.dataUrl;
    var image = url || (typeof localImage === 'string' ? localImage : '');

    if (!image) {
      root.classList.remove('mytube-has-background');
      root.style.removeProperty('--mytube-bg-image');
      root.style.removeProperty('--mytube-bg-dim');
      return;
    }

    root.classList.add('mytube-has-background');
    root.style.setProperty('--mytube-bg-image', 'url(' + JSON.stringify(image) + ')');
    root.style.setProperty(
      '--mytube-bg-dim',
      M.hexToRgba(state.settings.backgroundDimColor, state.settings.backgroundDimOpacity)
    );
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
      ensureWatchDimmer();
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

  function ensureWatchDimmer() {
    var player = document.querySelector('#movie_player');

    if (!isWatchPage() || !document.body || !player) {
      clearWatchDimmer();
      return;
    }

    if (watchDim.href !== location.href) {
      watchDim = { href: location.href, dismissed: false };
    }

    if (watchDim.dismissed) {
      clearWatchDimmer();
      return;
    }

    if (watchDimObserver && watchDimPlayer !== player) {
      if (watchDimPlayer) watchDimObserver.unobserve(watchDimPlayer);
      watchDimObserver.observe(player);
      watchDimPlayer = player;
    }

    var overlay = document.querySelector('body > .mytube-watch-dim');
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'mytube-watch-dim';
      overlay.setAttribute('role', 'button');
      overlay.setAttribute('tabindex', '0');
      overlay.setAttribute('aria-label', 'Reveal page');
      overlay.title = 'Reveal page';
      for (var i = 0; i < 4; i++) {
        var pane = document.createElement('div');
        pane.className = 'mytube-watch-dim-pane';
        pane.setAttribute('aria-hidden', 'true');
        overlay.appendChild(pane);
      }
      overlay.addEventListener('click', function (event) {
        event.preventDefault();
        event.stopPropagation();
        dismissWatchDimmer();
      });
      overlay.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ' || event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          dismissWatchDimmer();
        }
      });
      document.body.appendChild(overlay);
    }

    positionWatchDimmer(overlay, player);
  }

  function dismissWatchDimmer() {
    watchDim.dismissed = true;
    clearWatchDimmer();
  }

  function scheduleWatchDimLayout() {
    if (watchDimQueued) return;
    watchDimQueued = true;
    requestAnimationFrame(function () {
      watchDimQueued = false;
      var overlay = document.querySelector('body > .mytube-watch-dim');
      var player = document.querySelector('#movie_player');
      if (overlay && player) positionWatchDimmer(overlay, player);
    });
  }

  function positionWatchDimmer(overlay, player) {
    var rect = player.getBoundingClientRect();
    var panes = overlay.children;
    if (panes.length !== 4) return;

    if (!rect.width || !rect.height || document.fullscreenElement) {
      for (var i = 0; i < panes.length; i++) {
        setWatchDimPane(panes[i], 0, 0, 0, 0);
      }
      return;
    }

    var viewportWidth = window.innerWidth;
    var viewportHeight = window.innerHeight;
    var left = Math.max(0, Math.min(viewportWidth, rect.left));
    var right = Math.max(0, Math.min(viewportWidth, rect.right));
    var top = Math.max(0, Math.min(viewportHeight, rect.top));
    var bottom = Math.max(0, Math.min(viewportHeight, rect.bottom));

    var masthead = document.querySelector('#masthead-container');
    var mastheadBottom = 0;
    if (masthead) {
      var mastheadRect = masthead.getBoundingClientRect();
      if (mastheadRect.height > 0 && mastheadRect.bottom > 0) {
        mastheadBottom = Math.min(viewportHeight, mastheadRect.bottom);
      }
    }
    var holeTop = Math.max(top, mastheadBottom);

    setWatchDimPane(panes[0], 0, 0, viewportWidth, holeTop);
    setWatchDimPane(panes[1], right, holeTop, viewportWidth - right, bottom - holeTop);
    setWatchDimPane(panes[2], 0, bottom, viewportWidth, viewportHeight - bottom);
    setWatchDimPane(panes[3], 0, holeTop, left, bottom - holeTop);
  }

  function setWatchDimPane(pane, left, top, width, height) {
    pane.style.left = Math.max(0, left) + 'px';
    pane.style.top = Math.max(0, top) + 'px';
    pane.style.width = Math.max(0, width) + 'px';
    pane.style.height = Math.max(0, height) + 'px';
  }

  function clearWatchDimmer() {
    if (watchDimObserver) watchDimObserver.disconnect();
    watchDimPlayer = null;

    var overlays = document.querySelectorAll('.mytube-watch-dim, .mytube-related-dim');
    for (var i = 0; i < overlays.length; i++) overlays[i].remove();

    var legacy = document.querySelectorAll('.mytube-related-dimmed');
    for (var j = 0; j < legacy.length; j++) legacy[j].classList.remove('mytube-related-dimmed');
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
    card.setAttribute('aria-label', M.normalizeVideoTitle(meta.title || 'YouTube video'));

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
    title.textContent = M.normalizeVideoTitle(meta.title || '');
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

    card.setAttribute('aria-label', M.normalizeVideoTitle(meta.title || 'YouTube video'));
    var img = card.querySelector('.mytube-thumb-img');
    if (img && meta.thumb) {
      delete img.dataset.fallback;
      img.src = meta.thumb;
    }
    var duration = card.querySelector('.mytube-duration');
    if (duration) duration.textContent = M.formatDuration(meta.duration);
    var title = card.querySelector('.mytube-title');
    if (title) title.textContent = M.normalizeVideoTitle(meta.title || '');
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
   * Video titles
   * ------------------------------------------------------------------ */

  /**
   * Some titles use Unicode mathematical alphanumeric characters to fake a
   * custom font. Most fonts do not contain those glyphs, so the browser falls
   * back to a math font and ignores our font-family choice. Convert them to
   * plain text so the selected font actually applies.
   */
  function scheduleTitleNormalization() {
    if (titleQueued) return;
    titleQueued = true;
    setTimeout(function () {
      titleQueued = false;
      normalizeVideoTitles();
    }, 250);
  }

  function normalizeVideoTitles() {
    var nodes = document.querySelectorAll(TITLE_SCOPE);
    for (var i = 0; i < nodes.length; i++) normalizeTitleNode(nodes[i]);
  }

  function normalizeTitleNode(node) {
    normalizeTitleAttribute(node, 'title');
    normalizeTitleAttribute(node, 'aria-label');

    var attributed = node.querySelectorAll('[title], [aria-label]');
    for (var i = 0; i < attributed.length; i++) {
      normalizeTitleAttribute(attributed[i], 'title');
      normalizeTitleAttribute(attributed[i], 'aria-label');
    }

    var walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) {
      var textNode = walker.currentNode;
      var next = M.normalizeVideoTitle(textNode.nodeValue);
      if (next !== textNode.nodeValue) textNode.nodeValue = next;
    }
  }

  function normalizeTitleAttribute(node, name) {
    var value = node.getAttribute(name);
    if (!value) return;
    var next = M.normalizeVideoTitle(value);
    if (next !== value) node.setAttribute(name, next);
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
