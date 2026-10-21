/**
 * Code shared by the content script, the popup, and the tests.
 * Everything here is pure: no chrome.* access, no DOM access.
 */
(function (root) {
  'use strict';

  var SETTINGS_KEY = 'settings';
  var META_KEY = 'meta';
  var META_VERSION = 2;
  var META_TTL_MS = 24 * 60 * 60 * 1000;

  var DEFAULT_SETTINGS = {
    videos: [],
    brandText: 'MyTube',
    hidden: {
      comments: false,
      shorts: false,
      channel: false,
      posted: false,
      views: false,
      chips: false,
      sidebar: false,
      topbar: false,
      'watch-top-row': false,
      'watch-middle-row': false,
      'watch-bottom-row': false
    }
  };

  var VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
  var YOUTUBE_HOSTS = new Set(['youtube.com', 'youtu.be', 'youtube-nocookie.com']);
  var VIDEO_PATH_PREFIXES = new Set(['shorts', 'embed', 'live', 'v']);

  function parseVideoId(input) {
    if (typeof input !== 'string') return null;
    var value = input.trim();
    if (!value) return null;
    if (VIDEO_ID_RE.test(value)) return value;

    var url;
    try {
      url = new URL(value.indexOf('://') === -1 ? 'https://' + value : value);
    } catch (error) {
      return null;
    }

    var host = url.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
    if (!YOUTUBE_HOSTS.has(host)) return null;

    if (host === 'youtu.be') {
      var shortId = url.pathname.split('/').filter(Boolean)[0];
      return VIDEO_ID_RE.test(shortId || '') ? shortId : null;
    }

    var queryId = url.searchParams.get('v');
    if (queryId && VIDEO_ID_RE.test(queryId)) return queryId;

    var parts = url.pathname.split('/').filter(Boolean);
    if (parts.length >= 2 && VIDEO_PATH_PREFIXES.has(parts[0]) && VIDEO_ID_RE.test(parts[1])) {
      return parts[1];
    }

    return null;
  }

  function normalizeSettings(raw) {
    var settings = {
      videos: [],
      brandText: DEFAULT_SETTINGS.brandText,
      hidden: Object.assign({}, DEFAULT_SETTINGS.hidden)
    };
    if (!raw || typeof raw !== 'object') return settings;

    if (typeof raw.brandText === 'string') {
      settings.brandText = raw.brandText.slice(0, 40);
    }

    if (Array.isArray(raw.videos)) {
      for (var i = 0; i < raw.videos.length; i++) {
        var id = parseVideoId(raw.videos[i]);
        if (id && settings.videos.indexOf(id) === -1) settings.videos.push(id);
      }
    }

    if (raw.hidden && typeof raw.hidden === 'object') {
      Object.keys(settings.hidden).forEach(function (key) {
        if (typeof raw.hidden[key] === 'boolean') settings.hidden[key] = raw.hidden[key];
      });
    }

    return settings;
  }

  /**
   * Reads the JSON object that starts at the first "{" after `marker`.
   * Scans for the matching brace so strings, escapes, and nested objects are safe.
   */
  function extractJsonAfter(source, marker) {
    if (typeof source !== 'string') return null;
    var markerAt = source.indexOf(marker);
    if (markerAt === -1) return null;
    var start = source.indexOf('{', markerAt);
    if (start === -1) return null;

    var depth = 0;
    var inString = false;
    var escaped = false;

    for (var i = start; i < source.length; i++) {
      var ch = source[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(source.slice(start, i + 1));
          } catch (error) {
            return null;
          }
        }
      }
    }

    return null;
  }

  function normalizeThumbUrl(url) {
    if (typeof url !== 'string' || !url) return '';
    if (url.indexOf('//') === 0) return 'https:' + url;
    return url;
  }

  function findFirstKey(value, key, depth) {
    if (!value || typeof value !== 'object' || depth > 30) return null;
    if (Array.isArray(value)) {
      for (var i = 0; i < value.length; i++) {
        var foundInArray = findFirstKey(value[i], key, depth + 1);
        if (foundInArray) return foundInArray;
      }
      return null;
    }
    if (Object.prototype.hasOwnProperty.call(value, key)) return value[key];
    var keys = Object.keys(value);
    for (var k = 0; k < keys.length; k++) {
      var found = findFirstKey(value[keys[k]], key, depth + 1);
      if (found) return found;
    }
    return null;
  }

  function extractOwnerAvatar(html) {
    var data = extractJsonAfter(html, 'ytInitialData');
    if (!data) return '';
    var owner = findFirstKey(data, 'videoOwnerRenderer', 0);
    var thumbs = owner && owner.thumbnail && owner.thumbnail.thumbnails;
    if (!Array.isArray(thumbs) || !thumbs.length) return '';
    return normalizeThumbUrl(thumbs[thumbs.length - 1].url);
  }

  /** Pulls title / channel / views / date / duration out of a watch page's HTML. */
  function parseWatchPage(html) {
    var response = extractJsonAfter(html, 'ytInitialPlayerResponse');
    if (!response) return null;

    var details = response.videoDetails;
    if (!details || !details.videoId || !VIDEO_ID_RE.test(details.videoId)) return null;

    var micro = (response.microformat && response.microformat.playerMicroformatRenderer) || {};
    var thumbs = (details.thumbnail && details.thumbnail.thumbnails) || [];
    var thumb = thumbs.length ? normalizeThumbUrl(thumbs[thumbs.length - 1].url) : '';
    var views = Number(details.viewCount);
    var duration = Number(details.lengthSeconds);

    return {
      id: details.videoId,
      title: details.title || '',
      author: details.author || micro.ownerChannelName || '',
      views: Number.isFinite(views) && views >= 0 ? views : null,
      published: micro.publishDate || micro.uploadDate || '',
      duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
      thumb: thumb,
      avatar: extractOwnerAvatar(html)
    };
  }

  var compactNumber = new Intl.NumberFormat('en', {
    notation: 'compact',
    maximumFractionDigits: 1
  });

  function formatViews(views) {
    if (views === null || views === undefined) return '';
    var count = Number(views);
    if (!Number.isFinite(count) || count < 0) return '';
    if (count === 0) return 'No views';
    if (count === 1) return '1 view';
    if (count < 1000) return Math.round(count) + ' views';
    return compactNumber.format(count).replace(/\.0(?=[KMB])/, '') + ' views';
  }

  function formatCompactViews(views) {
    if (views === null || views === undefined) return '';
    var count = Number(views);
    if (!Number.isFinite(count) || count < 0) return '';
    if (count === 0) return 'No views';
    if (count === 1) return '1 view';
    if (count < 1000) return String(Math.round(count));
    return compactNumber.format(count).replace(/\.0(?=[KMB])/, '');
  }

  function formatDuration(totalSeconds) {
    var seconds = Number(totalSeconds);
    if (!Number.isFinite(seconds) || seconds <= 0) return '';
    var whole = Math.round(seconds);
    var hours = Math.floor(whole / 3600);
    var minutes = Math.floor((whole % 3600) / 60);
    var secs = whole % 60;
    var tail = String(secs).padStart(2, '0');
    if (hours > 0) return hours + ':' + String(minutes).padStart(2, '0') + ':' + tail;
    return minutes + ':' + tail;
  }

  var RELATIVE_UNITS = [
    ['year', 31536000],
    ['month', 2592000],
    ['week', 604800],
    ['day', 86400],
    ['hour', 3600],
    ['minute', 60]
  ];

  function formatRelativeDate(isoDate, now) {
    var published = Date.parse(isoDate);
    if (!Number.isFinite(published)) return '';
    var current = Number.isFinite(now) ? now : Date.now();
    var elapsed = Math.max(0, Math.floor((current - published) / 1000));
    if (elapsed < 60) return 'just now';

    for (var i = 0; i < RELATIVE_UNITS.length; i++) {
      var unit = RELATIVE_UNITS[i];
      if (elapsed >= unit[1]) {
        var amount = Math.floor(elapsed / unit[1]);
        return amount + ' ' + unit[0] + (amount === 1 ? '' : 's') + ' ago';
      }
    }
    return 'just now';
  }

  function formatCompactDate(isoDate, now) {
    var published = Date.parse(isoDate);
    if (!Number.isFinite(published)) return '';
    var current = Number.isFinite(now) ? now : Date.now();
    var elapsed = Math.max(0, Math.floor((current - published) / 1000));
    if (elapsed < 60) return 'just now';
    if (elapsed >= 31536000) return Math.floor(elapsed / 31536000) + 'y ago';
    if (elapsed >= 2592000) return Math.floor(elapsed / 2592000) + 'mo ago';
    if (elapsed >= 604800) return Math.floor(elapsed / 604800) + 'w ago';
    if (elapsed >= 86400) return Math.floor(elapsed / 86400) + 'd ago';
    if (elapsed >= 3600) return Math.floor(elapsed / 3600) + 'h ago';
    return Math.floor(elapsed / 60) + 'm ago';
  }

  function avatarLetter(name) {
    var trimmed = (name || '').trim();
    if (!trimmed) return '';
    var first = Array.from(trimmed)[0];
    return /[\p{L}\p{N}]/u.test(first) ? first.toUpperCase() : '#';
  }

  function avatarHue(name) {
    var text = name || '';
    var hash = 0;
    for (var i = 0; i < text.length; i++) {
      hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
    }
    return hash % 360;
  }

  var api = {
    SETTINGS_KEY: SETTINGS_KEY,
    META_KEY: META_KEY,
    META_VERSION: META_VERSION,
    META_TTL_MS: META_TTL_MS,
    DEFAULT_SETTINGS: DEFAULT_SETTINGS,
    parseVideoId: parseVideoId,
    normalizeSettings: normalizeSettings,
    extractJsonAfter: extractJsonAfter,
    parseWatchPage: parseWatchPage,
    formatViews: formatViews,
    formatCompactViews: formatCompactViews,
    formatDuration: formatDuration,
    formatRelativeDate: formatRelativeDate,
    formatCompactDate: formatCompactDate,
    avatarLetter: avatarLetter,
    avatarHue: avatarHue
  };

  root.MyTube = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
