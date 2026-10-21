(function () {
  'use strict';

  var M = globalThis.MyTube;
  var state = {
    settings: M.normalizeSettings(null),
    meta: {}
  };

  var TOGGLES = [
    { key: 'comments', label: 'Comments' },
    { key: 'shorts', label: 'Shorts', note: 'Shorts links open the home page' },
    { key: 'channel', label: 'Channel name & avatar' },
    { key: 'posted', label: 'Posted date' },
    { key: 'views', label: 'View count' },
    { key: 'chips', label: 'Filter chips' },
    { key: 'sidebar', label: 'Left sidebar' },
    { key: 'topbar', label: 'Top bar & search' },
    { key: 'watch-top-row', label: 'Video top row', note: 'Channel, subscribe, likes' },
    { key: 'watch-middle-row', label: 'Video middle row' },
    { key: 'watch-bottom-row', label: 'Video bottom row', note: 'Description' }
  ];

  var form = document.getElementById('add-form');
  var input = document.getElementById('url-input');
  var brandInput = document.getElementById('brand-input');
  var errorNode = document.getElementById('error');
  var listNode = document.getElementById('video-list');
  var emptyNode = document.getElementById('empty-videos');
  var countNode = document.getElementById('video-count');
  var togglesNode = document.getElementById('toggles');
  var template = document.getElementById('video-item-template');

  boot();

  async function boot() {
    buildToggles();

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
    renderVideos();
    syncToggles();
    syncBrandInput();

    form.addEventListener('submit', onAdd);
    input.addEventListener('keydown', function (event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        onAdd(event);
      }
    });
    brandInput.addEventListener('input', function () {
      state.settings.brandText = brandInput.value.slice(0, 40);
      save();
    });

    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'sync' && changes[M.SETTINGS_KEY]) {
        state.settings = M.normalizeSettings(changes[M.SETTINGS_KEY].newValue);
        renderVideos();
        syncToggles();
        syncBrandInput();
      }
      if (area === 'local' && changes[M.META_KEY]) {
        state.meta = changes[M.META_KEY].newValue || {};
        renderVideos();
      }
    });
  }

  function buildToggles() {
    var fragment = document.createDocumentFragment();

    TOGGLES.forEach(function (item) {
      var label = document.createElement('label');
      label.className = 'toggle';

      var text = document.createElement('span');
      text.className = 'toggle-text';

      var title = document.createElement('span');
      title.className = 'toggle-label';
      title.textContent = item.label;
      text.appendChild(title);

      if (item.note) {
        var note = document.createElement('span');
        note.className = 'toggle-note';
        note.textContent = item.note;
        text.appendChild(note);
      }

      var checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.id = 'toggle-' + item.key;
      checkbox.setAttribute('role', 'switch');
      checkbox.dataset.key = item.key;
      checkbox.addEventListener('change', function () {
        state.settings.hidden[item.key] = checkbox.checked;
        save();
      });

      var knob = document.createElement('span');
      knob.className = 'switch';
      knob.setAttribute('aria-hidden', 'true');

      label.appendChild(text);
      label.appendChild(checkbox);
      label.appendChild(knob);
      fragment.appendChild(label);
    });

    togglesNode.replaceChildren(fragment);
  }

  function syncToggles() {
    togglesNode.querySelectorAll('input[data-key]').forEach(function (checkbox) {
      checkbox.checked = Boolean(state.settings.hidden[checkbox.dataset.key]);
    });
  }

  function syncBrandInput() {
    if (document.activeElement === brandInput) return;
    brandInput.value = state.settings.brandText;
  }

  function onAdd(event) {
    event.preventDefault();
    var raw = input.value.trim();
    if (!raw) return;

    var tokens = raw.split(/[\s,]+/).filter(Boolean);
    var invalid = [];
    var added = 0;

    tokens.forEach(function (token) {
      var id = M.parseVideoId(token);
      if (!id) {
        invalid.push(token);
        return;
      }
      if (state.settings.videos.indexOf(id) !== -1) return;
      state.settings.videos.push(id);
      added++;
    });

    if (invalid.length) {
      var preview = invalid.slice(0, 2).join(', ');
      showError(
        invalid.length > 2
          ? 'Not YouTube video links: ' + preview + '…'
          : 'Not a YouTube video link: ' + preview
      );
    } else {
      hideError();
    }

    if (added) {
      save();
      renderVideos();
      input.value = '';
      input.focus();
    }
  }

  function renderVideos() {
    var videos = state.settings.videos;
    countNode.textContent = String(videos.length);
    emptyNode.hidden = videos.length > 0;

    var fragment = document.createDocumentFragment();

    videos.forEach(function (id) {
      var meta = state.meta[id] || {};
      var node = template.content.firstElementChild.cloneNode(true);
      var img = node.querySelector('.video-thumb');
      var title = node.querySelector('.video-title');
      var url = node.querySelector('.video-url');
      var remove = node.querySelector('.remove');

      img.src = meta.thumb || 'https://i.ytimg.com/vi/' + id + '/mqdefault.jpg';
      title.textContent = meta.title || 'YouTube video';
      url.textContent = 'youtube.com/watch?v=' + id;
      remove.setAttribute('aria-label', 'Remove ' + (meta.title || 'video'));
      remove.addEventListener('click', function () {
        state.settings.videos = state.settings.videos.filter(function (videoId) {
          return videoId !== id;
        });
        save();
        renderVideos();
      });

      fragment.appendChild(node);
    });

    listNode.replaceChildren(fragment);
  }

  function showError(message) {
    errorNode.textContent = message;
    errorNode.hidden = false;
  }

  function hideError() {
    errorNode.hidden = true;
    errorNode.textContent = '';
  }

  function save() {
    chrome.storage.sync.set({ [M.SETTINGS_KEY]: state.settings }).catch(function () {
      showError('Could not save. Check Chrome sync storage.');
    });
  }
})();
