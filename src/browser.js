/**
 * Cross-browser WebExtension API handle.
 *
 * Firefox (and therefore Zen) exposes both `browser` and `chrome`. The
 * `browser` namespace returns promises, while `chrome` on Firefox is
 * callback-based. Chromium-based browsers only expose `chrome`, which does
 * return promises in Manifest V3. Preferring `browser` gives promise-based
 * calls everywhere.
 */
(function (root) {
  'use strict';

  var api =
    root.browser && root.browser.runtime && root.browser.runtime.id
      ? root.browser
      : root.chrome;

  root.MyTubeBrowser = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
