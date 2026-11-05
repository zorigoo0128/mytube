(function () {
  'use strict';

  var M = globalThis.MyTube;
  var B = globalThis.MyTubeBrowser || globalThis.chrome;
  var state = {
    settings: M.normalizeSettings(null),
    meta: {},
    background: null
  };

  var NUMBER_INPUTS = [
    { id: 'thumbnail-radius-input', key: 'thumbnailRadius', min: 0, max: 40 },
    { id: 'card-size-input', key: 'cardSize', min: 180, max: 480 },
    { id: 'card-gap-input', key: 'cardGap', min: 0, max: 48 },
    { id: 'font-size-input', key: 'fontSize', min: 0, max: 32 },
    { id: 'background-dim-opacity-input', key: 'backgroundDimOpacity', min: 0, max: 1 }
  ];

  var TEXT_INPUTS = [
    { id: 'font-family-input', key: 'fontFamily', max: 80 },
    { id: 'text-color-input', key: 'textColor', max: 40 },
    { id: 'background-url-input', key: 'backgroundUrl', max: 2048 },
    { id: 'background-dim-color-input', key: 'backgroundDimColor', max: 7 },
    { id: 'css-filter-input', key: 'cssFilter', max: 200 }
  ];

  var GENERIC_FONTS = [
    'system-ui',
    'ui-sans-serif',
    'ui-serif',
    'ui-monospace',
    'sans-serif',
    'serif',
    'monospace',
    'cursive',
    'fantasy'
  ];

  var FALLBACK_FONTS = [
    'Arial',
    'Arial Black',
    'Comic Sans MS',
    'Courier New',
    'Georgia',
    'Helvetica',
    'Helvetica Neue',
    'Impact',
    'Inter',
    'Lucida Console',
    'Roboto',
    'Tahoma',
    'Times New Roman',
    'Trebuchet MS',
    'Verdana'
  ];

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
  var backgroundFileInput = document.getElementById('background-file-input');
  var backgroundStatus = document.getElementById('background-status');
  var backgroundRemove = document.getElementById('background-remove');
  var errorNode = document.getElementById('error');
  var listNode = document.getElementById('video-list');
  var emptyNode = document.getElementById('empty-videos');
  var countNode = document.getElementById('video-count');
  var togglesNode = document.getElementById('toggles');
  var template = document.getElementById('video-item-template');
  var exportDataButton = document.getElementById('export-data');
  var importDataButton = document.getElementById('import-data');
  var importFileInput = document.getElementById('import-file-input');
  var dataStatus = document.getElementById('data-status');
  var backgroundDimColorInput = document.getElementById('background-dim-color-input');
  var pageNote = document.getElementById('page-note');
  var runningInTab = false;

  var SECTION_BY_HASH = {
    videos: 'section-videos',
    layout: 'section-layout',
    theme: 'section-theme',
    hide: 'section-hide',
    data: 'section-data'
  };

  boot();

  async function boot() {
    runningInTab = await detectTab();
    if (runningInTab) {
      document.body.classList.add('tab-view');
      pageNote.hidden = false;
    }
    applyHash();

    buildToggles();

    var [sync, local] = await Promise.all([
      B.storage.sync.get(M.SETTINGS_KEY).catch(function () {
        return {};
      }),
      B.storage.local.get([M.META_KEY, M.BACKGROUND_KEY]).catch(function () {
        return {};
      })
    ]);

    state.settings = M.normalizeSettings(sync[M.SETTINGS_KEY]);
    state.meta = local[M.META_KEY] || {};
    state.background = local[M.BACKGROUND_KEY] || null;
    renderVideos();
    syncToggles();
    syncBrandInput();
    updateBackgroundStatus();
    await loadFontOptions();
    syncStyleInputs();

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

    NUMBER_INPUTS.forEach(function (item) {
      var node = document.getElementById(item.id);

      node.addEventListener('input', function () {
        var value = node.valueAsNumber;
        if (!Number.isFinite(value)) return;
        state.settings[item.key] = Math.min(item.max, Math.max(item.min, value));
        save();
      });

      node.addEventListener('blur', function () {
        node.value = state.settings[item.key];
      });
    });

    TEXT_INPUTS.forEach(function (item) {
      var node = document.getElementById(item.id);

      node.addEventListener('input', function () {
        state.settings[item.key] = node.value.slice(0, item.max);
        save();
        if (item.key === 'backgroundUrl') updateBackgroundStatus();
      });

      node.addEventListener('blur', function () {
        state.settings[item.key] = node.value.trim().slice(0, item.max);
        node.value = state.settings[item.key];
        save();
        if (item.key === 'backgroundUrl') updateBackgroundStatus();
      });
    });

    backgroundFileInput.addEventListener('change', onBackgroundFile);
    backgroundFileInput.addEventListener('click', function (event) {
      if (runningInTab) return;
      event.preventDefault();
      openSettingsPage('theme');
    });
    backgroundDimColorInput.addEventListener('click', function (event) {
      if (runningInTab) return;
      event.preventDefault();
      openSettingsPage('theme');
    });
    backgroundRemove.addEventListener('click', onRemoveBackground);
    exportDataButton.addEventListener('click', onExportData);
    importDataButton.addEventListener('click', function () {
      if (!runningInTab) {
        openSettingsPage('data');
        return;
      }
      importFileInput.click();
    });
    importFileInput.addEventListener('change', onImportData);
    window.addEventListener('hashchange', applyHash);

    B.storage.onChanged.addListener(function (changes, area) {
      if (area === 'sync' && changes[M.SETTINGS_KEY]) {
        state.settings = M.normalizeSettings(changes[M.SETTINGS_KEY].newValue);
        renderVideos();
        syncToggles();
        syncBrandInput();
        syncStyleInputs();
        updateBackgroundStatus();
      }
      if (area === 'local' && changes[M.META_KEY]) {
        state.meta = changes[M.META_KEY].newValue || {};
        renderVideos();
      }
      if (area === 'local' && changes[M.BACKGROUND_KEY]) {
        state.background = changes[M.BACKGROUND_KEY].newValue || null;
        updateBackgroundStatus();
      }
    });
  }

  function detectTab() {
    try {
      if (!B.tabs || typeof B.tabs.getCurrent !== 'function') return Promise.resolve(false);
      return Promise.resolve(B.tabs.getCurrent())
        .then(function (tab) {
          return Boolean(tab);
        })
        .catch(function () {
          return false;
        });
    } catch (error) {
      return Promise.resolve(false);
    }
  }

  function openSettingsPage(section) {
    var url = B.runtime.getURL('src/popup.html');
    if (section) url += '#' + section;

    try {
      var pending = B.tabs.create({ url: url });
      if (pending && typeof pending.then === 'function') {
        pending.then(closePopup, function () {});
      } else {
        window.setTimeout(closePopup, 0);
      }
    } catch (error) {
      setDataStatus('Could not open the settings page.', true);
    }
  }

  function closePopup() {
    if (!runningInTab) window.close();
  }

  function applyHash() {
    var name = window.location.hash.replace(/^#/, '').trim();
    if (!name) return;

    var target = document.getElementById(SECTION_BY_HASH[name] || name);
    if (!target) return;

    if (target.tagName === 'DETAILS') target.open = true;
    target.scrollIntoView({ block: 'start' });

    var heading = target.querySelector('summary');
    if (heading) heading.focus({ preventScroll: true });
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

  function syncStyleInputs() {
    NUMBER_INPUTS.concat(TEXT_INPUTS).forEach(function (item) {
      var node = document.getElementById(item.id);
      if (document.activeElement === node && node.type !== 'color') return;
      if (item.key === 'fontFamily') ensureFontOption(state.settings.fontFamily);
      node.value = state.settings[item.key];
    });
  }

  async function loadFontOptions() {
    var datalist = document.getElementById('font-family-options');
    var inputNode = document.getElementById('font-family-input');
    var selected = state.settings.fontFamily || '';
    var names = new Set(GENERIC_FONTS);

    try {
      if (B.fontSettings && typeof B.fontSettings.getFontList === 'function') {
        var installed = await B.fontSettings.getFontList();
        installed.forEach(function (font) {
          var name = font && (font.displayName || font.fontId);
          if (name) names.add(name);
        });
      }
    } catch (error) {
      /* Firefox/Zen without the fontSettings API falls back to the list below */
    }

    if (names.size <= GENERIC_FONTS.length) {
      FALLBACK_FONTS.forEach(function (name) {
        names.add(name);
      });
    }

    if (selected) names.add(selected);

    var sorted = Array.from(names).sort(function (a, b) {
      return a.localeCompare(b, undefined, { sensitivity: 'base' });
    });
    var fragment = document.createDocumentFragment();

    sorted.forEach(function (name) {
      var option = document.createElement('option');
      option.value = name;
      option.textContent = name;
      fragment.appendChild(option);
    });

    datalist.replaceChildren(fragment);
    inputNode.value = selected;
  }

  function ensureFontOption(value) {
    if (!value) return;
    var datalist = document.getElementById('font-family-options');
    for (var i = 0; i < datalist.options.length; i++) {
      if (datalist.options[i].value === value) return;
    }
    var option = document.createElement('option');
    option.value = value;
    option.textContent = value;
    datalist.appendChild(option);
  }

  function updateBackgroundStatus() {
    var localImage = state.background && state.background.dataUrl;
    var url = (state.settings.backgroundUrl || '').trim();
    var isFileUrl = /^file:/i.test(url);
    var isUsableUrl = /^(https?:\/\/|data:image\/)/i.test(url);
    var message = 'No background image.';
    var hasError = false;

    if (isFileUrl) {
      hasError = true;
      message = localImage
        ? 'Browsers block file:// paths. Using the local image: ' + (state.background.name || 'selected file') + '.'
        : 'Browsers block file:// paths. Choose the image below instead.';
    } else if (url && !isUsableUrl) {
      hasError = true;
      message = localImage
        ? 'Use an https:// image URL. Using the local image: ' + (state.background.name || 'selected file') + '.'
        : 'Use an https:// image URL, or choose a local image below.';
    } else if (url) {
      message = 'Using image URL: ' + url;
    } else if (localImage) {
      message = 'Using local image: ' + (state.background.name || 'selected file');
    }

    backgroundStatus.textContent = message;
    backgroundStatus.classList.toggle('status-error', hasError);
    backgroundRemove.disabled = !localImage && !url;
  }

  async function onBackgroundFile() {
    var file = backgroundFileInput.files && backgroundFileInput.files[0];
    if (!file) return;

    try {
      var dataUrl = await prepareBackgroundImage(file);
      state.background = { dataUrl: dataUrl, name: file.name, at: Date.now() };
      await B.storage.local.set({ [M.BACKGROUND_KEY]: state.background });
      state.settings.backgroundUrl = '';
      document.getElementById('background-url-input').value = '';
      save();
      updateBackgroundStatus();
    } catch (error) {
      backgroundStatus.textContent = error && error.message ? error.message : 'Could not read that image.';
      backgroundStatus.classList.add('status-error');
    } finally {
      backgroundFileInput.value = '';
    }
  }

  async function onRemoveBackground() {
    state.background = null;
    state.settings.backgroundUrl = '';
    document.getElementById('background-url-input').value = '';
    await B.storage.local.remove(M.BACKGROUND_KEY).catch(function () {});
    save();
    updateBackgroundStatus();
  }

  function prepareBackgroundImage(file) {
    if (!/^image\//.test(file.type)) {
      return Promise.reject(new Error('Choose an image file.'));
    }
    if (file.size > 25 * 1024 * 1024) {
      return Promise.reject(new Error('Image is too large (max 25 MB).'));
    }

    return createImageBitmap(file)
      .then(function (bitmap) {
        var maxSide = 2560;
        var scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
        var canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(bitmap.width * scale));
        canvas.height = Math.max(1, Math.round(bitmap.height * scale));

        var context = canvas.getContext('2d');
        if (!context) throw new Error('Could not process that image.');
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
        if (bitmap.close) bitmap.close();

        var dataUrl = canvas.toDataURL('image/webp', 0.85);
        if (dataUrl.indexOf('data:image/') !== 0) throw new Error('Could not process that image.');
        return dataUrl;
      })
      .catch(function (error) {
        if (error && error.message) throw error;
        throw new Error('Could not read that image.');
      });
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

  async function onExportData() {
    try {
      var [sync, local] = await Promise.all([
        B.storage.sync.get(null),
        B.storage.local.get(null)
      ]);

      var payload = {
        format: 'mytube-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        sync: { [M.SETTINGS_KEY]: sync[M.SETTINGS_KEY] },
        local: {
          [M.META_KEY]: local[M.META_KEY],
          [M.BACKGROUND_KEY]: local[M.BACKGROUND_KEY]
        }
      };

      var blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      var url = URL.createObjectURL(blob);
      var link = document.createElement('a');
      link.href = url;
      link.download = 'mytube-backup-' + new Date().toISOString().slice(0, 10) + '.json';
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(function () {
        URL.revokeObjectURL(url);
      }, 10000);

      setDataStatus('Exported settings, video list, metadata cache, and background.');
    } catch (error) {
      setDataStatus('Could not export data.', true);
    }
  }

  async function onImportData() {
    var file = importFileInput.files && importFileInput.files[0];
    if (!file) return;

    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('That backup is too large.');

      var payload;
      try {
        payload = JSON.parse(await file.text());
      } catch (error) {
        throw new Error('That is not a MyTube backup file.');
      }

      var backup = M.normalizeBackup(payload);
      if (!backup) throw new Error('That is not a MyTube backup file.');

      await B.storage.sync.set({ [M.SETTINGS_KEY]: backup.settings });
      if (backup.meta) await B.storage.local.set({ [M.META_KEY]: backup.meta });
      else await B.storage.local.remove(M.META_KEY);
      if (backup.background) await B.storage.local.set({ [M.BACKGROUND_KEY]: backup.background });
      else await B.storage.local.remove(M.BACKGROUND_KEY);

      var count = backup.settings.videos.length;
      setDataStatus('Imported ' + count + ' video' + (count === 1 ? '' : 's') + '.');
    } catch (error) {
      setDataStatus(error && error.message ? error.message : 'Could not import that file.', true);
    } finally {
      importFileInput.value = '';
    }
  }

  function setDataStatus(message, isError) {
    dataStatus.textContent = message;
    dataStatus.classList.toggle('status-error', Boolean(isError));
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
    B.storage.sync.set({ [M.SETTINGS_KEY]: state.settings }).catch(function () {
      showError('Could not save. Check browser sync storage.');
    });
  }
})();
