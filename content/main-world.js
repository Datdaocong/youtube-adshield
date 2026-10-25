/*
 * YT AdShield v1.2.1 – main-world script (chạy TRƯỚC mọi script của YouTube,
 * kể cả "locker script" anti-tamper mà YouTube chèn đầu <head>).
 *
 * Chiến lược "không bị phát hiện":
 *  1. Cắt dữ liệu quảng cáo (adPlacements/adSlots/playerAds) khỏi mọi phản hồi
 *     JSON -> player không bao giờ nhận lệnh chèn quảng cáo.
 *  2. Gắn cờ isInlinePlaybackNoAd vào yêu cầu player -> server chủ động trả
 *     về response KHÔNG quảng cáo, đồng thời không áp SABR backoff
 *     ("fake buffering" – cơ chế làm chậm video bằng đúng thời lượng quảng cáo
 *     mà YouTube A/B test từ 2025).
 *  3. Gỡ quảng cáo Shorts (entry có reelWatchEndpoint.adClientParams.isAd).
 *  4. Mọi hàm bị đè đều được ngụy trang "trông như native" (toString/name/length)
 *     để qua mặt các integrity check.
 *  5. Báo về isolate world số phần tử quảng cáo đã cắt (để hiện badge).
 *
 * Hiệu năng (v1.2.1 – sửa lag khi chuyển video):
 *  - Cắt theo ĐƯỜNG DẤN ĐÍCH (theo uAssets quick-fixes) thay vì đi đệ quy toàn
 *    cây JSON: mỗi response chỉ tốn vài phép đọc thuộc tính, bất kể dung lượng.
 *  - Quét sâu chỉ chạy dự phòng khi chuỗi nhỏ (<500KB) và marker có mặt mà
 *    đường dẫn chuẩn không cắt được gì — không bao giờ chạm payload lớn.
 *  - Marker kiểm tra bằng MỘT regex quét một lượt thay vì nhiều lần includes().
 */
(() => {
  'use strict';

  const AD_KEYS = new Set(['adPlacements', 'adSlots', 'playerAds']);
  const AD_KEYS_LIST = ['adPlacements', 'adSlots', 'playerAds'];
  let noAdFlag = true;

  const IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
  const hasOwn = Object.prototype.hasOwnProperty;

  // ========== Ngụy trang "như native" ==========
  const origToString = Function.prototype.toString;
  const nativeFaces = new WeakMap();

  const lookNative = (fn, source) => {
    nativeFaces.set(fn, source || `function ${fn.name || ''}() { [native code] }`);
  };
  const copyFace = (fn, model, name) => {
    try {
      if (name) Object.defineProperty(fn, 'name', { value: name, configurable: true });
      else if (model && model.name) {
        Object.defineProperty(fn, 'name', { value: model.name, configurable: true });
      }
      if (model) Object.defineProperty(fn, 'length', { value: model.length, configurable: true });
    } catch (e) {
      /* bỏ qua */
    }
    lookNative(fn);
  };

  Function.prototype.toString = function toString() {
    if (nativeFaces.has(this)) return nativeFaces.get(this);
    return origToString.call(this);
  };
  lookNative(Function.prototype.toString, 'function toString() { [native code] }');

  // ========== Cắt dữ liệu quảng cáo ==========
  const isShortsAdEntry = (item) => {
    try {
      const p =
        item && item.command && item.command.reelWatchEndpoint &&
        item.command.reelWatchEndpoint.adClientParams;
      return !!(p && p.isAd === true);
    } catch (e) {
      return false;
    }
  };

  const deleteKeys = (obj, keys) => {
    let n = 0;
    for (const key of keys) {
      if (hasOwn.call(obj, key)) {
        delete obj[key];
        n++;
      }
    }
    return n;
  };

  // Cắt theo đường dẫn chuẩn (rẻ, O(số đường dẫn) bất kể kích thước payload):
  // - gốc: adPlacements / adSlots / playerAds  (response của /player)
  // - playerResponse.*                        (response của /next, ytInitialData)
  // - entries[]: entry Shorts quảng cáo
  const scrub = (root) => {
    if (!root || typeof root !== 'object') return 0;
    let removed = deleteKeys(root, AD_KEYS_LIST);
    const inner = root.playerResponse;
    if (inner && typeof inner === 'object') removed += deleteKeys(inner, AD_KEYS_LIST);
    if (Array.isArray(root.entries)) {
      for (let i = root.entries.length - 1; i >= 0; i--) {
        if (isShortsAdEntry(root.entries[i])) {
          root.entries.splice(i, 1);
          removed++;
        }
      }
    }
    return removed;
  };

  // Quét sâu dự phòng – chỉ chạy cho payload nhỏ để không gây lag.
  const deepPrune = (node, stats, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        if (isShortsAdEntry(node[i])) {
          node.splice(i, 1);
          stats.removed++;
          continue;
        }
        deepPrune(node[i], stats, depth + 1);
      }
      return;
    }
    for (const key in node) {
      if (!hasOwn.call(node, key)) continue;
      if (AD_KEYS.has(key)) {
        delete node[key];
        stats.removed++;
        continue;
      }
      deepPrune(node[key], stats, depth + 1);
    }
  };

  // Marker: MỘT regex quét một lượt (thay vì nhiều lần includes trên chuỗi lớn).
  const MARKERS = new Set(['"reelWatchEndpoint"']);
  for (const key of AD_KEYS) MARKERS.add('"' + key + '"');
  const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const buildMarkerRe = () =>
    new RegExp(Array.from(MARKERS).map(escapeRe).join('|'));
  let MARKER_RE = buildMarkerRe();

  const DEEP_SCAN_LIMIT = 500000; // chỉ quét sâu payload < 500KB

  const notifyPrune = (delta) => {
    try {
      window.postMessage({ __ytadshieldStat: true, delta }, '*');
    } catch (e) {
      /* bỏ qua */
    }
  };

  const scrubTree = (root, fullScanText) => {
    try {
      let removed = scrub(root);
      if (
        removed === 0 &&
        typeof fullScanText === 'string' &&
        fullScanText.length < DEEP_SCAN_LIMIT
      ) {
        const stats = { removed: 0 };
        deepPrune(root, stats, 0);
        removed = stats.removed;
      }
      if (removed > 0) notifyPrune(removed);
    } catch (e) {
      /* không bao giờ để lỗi làm vỡ trang */
    }
  };

  // ========== Bắt JSON.parse ==========
  const origParse = JSON.parse;
  const parsePatch = function parse(text, reviver) {
    const data = origParse.call(JSON, text, reviver);
    try {
      if (typeof text === 'string' && text.length < 20000000 && MARKER_RE.test(text)) {
        scrubTree(data, text);
      }
    } catch (e) {
      /* không bao giờ để lỗi làm vỡ trang */
    }
    return data;
  };
  copyFace(parsePatch, origParse, 'parse');
  JSON.parse = parsePatch;

  // ========== Bắt JSON.stringify: ra lệnh cho server KHÔNG trả quảng cáo ==========
  // Chèn isInlinePlaybackNoAd:true vào body của /youtubei/v1/player — InnerTube
  // sẽ trả response sạch quảng cáo và không tính SABR backoff (chống fake buffering).
  const origStringify = JSON.stringify;
  const stringifyPatch = function stringify(value, replacer, space) {
    const text = origStringify.call(JSON, value, replacer, space);
    try {
      if (
        noAdFlag &&
        typeof text === 'string' &&
        text.length < 2000000 &&
        text.includes('"contentPlaybackContext":{') &&
        !text.includes('"isInlinePlaybackNoAd"')
      ) {
        return text.replace(
          '"contentPlaybackContext":{',
          '"contentPlaybackContext":{"isInlinePlaybackNoAd":true,'
        );
      }
    } catch (e) {
      /* không bao giờ để lỗi làm vỡ trang */
    }
    return text;
  };
  copyFace(stringifyPatch, origStringify, 'stringify');
  JSON.stringify = stringifyPatch;

  // ========== Bắt Response.json() của fetch ==========
  const origJson = Response.prototype.json;
  const jsonPatch = async function json() {
    const data = await origJson.call(this);
    try {
      scrubTree(data);
    } catch (e) {
      /* bỏ qua */
    }
    return data;
  };
  copyFace(jsonPatch, origJson, 'json');
  Response.prototype.json = jsonPatch;

  // ========== Bắt XMLHttpRequest (dự phòng) ==========
  const origOpen = XMLHttpRequest.prototype.open;
  const openPatch = function open(method, url, ...rest) {
    this.__ytAdUrl = String(url || '');
    return origOpen.apply(this, [method, url, ...rest]);
  };
  copyFace(openPatch, origOpen, 'open');
  XMLHttpRequest.prototype.open = openPatch;

  const origSend = XMLHttpRequest.prototype.send;
  const sendPatch = function send(...args) {
    this.addEventListener('load', () => {
      try {
        if (this.responseType === 'json' && this.__ytAdUrl.includes('/youtubei/')) {
          scrubTree(this.response);
        }
      } catch (e) {
        /* bỏ qua */
      }
    });
    return origSend.apply(this, args);
  };
  copyFace(sendPatch, origSend, 'send');
  XMLHttpRequest.prototype.send = sendPatch;

  // ========== Bẫy biến toàn cục nhúng trực tiếp trong HTML ==========
  // (Những dữ liệu này không đi qua JSON.parse.)
  const TRAPPED = new Set();
  const trap = (name) => {
    if (TRAPPED.has(name)) return true;
    let current = null;
    try {
      current = Object.getOwnPropertyDescriptor(window, name);
    } catch (e) {
      return false;
    }
    if (current && current.get && current.set) {
      // đã là accessor (bẫy của chúng ta hoặc của trang) – không đụng nữa
      TRAPPED.add(name);
      return true;
    }
    if (current && !current.configurable) return false;
    try {
      let holder = current ? current.value : undefined;
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          return holder;
        },
        set(value) {
          try {
            if (value && typeof value === 'object') scrubTree(value);
          } catch (e) {
            /* bỏ qua */
          }
          holder = value;
        },
      });
      TRAPPED.add(name);
      return true;
    } catch (e) {
      return false;
    }
  };
  trap('ytInitialPlayerResponse');
  trap('ytInitialData');

  // YouTube là SPA – sau mỗi lần điều hướng, kiểm tra lại bẫy và cắt nốt dữ
  // liệu mới gán vào biến toàn cục (bản thân scrub rất rẻ nên không gây lag).
  const rescrub = () => {
    try {
      trap('ytInitialPlayerResponse');
      trap('ytInitialData');
      const pr = window.ytInitialPlayerResponse;
      if (pr && typeof pr === 'object') scrubTree(pr);
      if (window.ytInitialData && typeof window.ytInitialData === 'object') {
        scrubTree(window.ytInitialData);
      }
    } catch (e) {
      /* bỏ qua */
    }
  };
  document.addEventListener('yt-navigate-finish', rescrub, true);
  document.addEventListener('yt-page-data-updated', rescrub, true);

  // ========== Nhận cấu hình từ trang options (bridge qua isolate world) ==========
  window.addEventListener(
    'message',
    (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__ytadshield !== true) return;
      try {
        if (Array.isArray(data.extraKeys)) {
          for (const key of data.extraKeys) {
            if (typeof key === 'string' && IDENT_RE.test(key) && !AD_KEYS.has(key)) {
              AD_KEYS.add(key);
              AD_KEYS_LIST.push(key);
              MARKERS.add('"' + key + '"');
              MARKER_RE = buildMarkerRe();
            }
          }
        }
        if (typeof data.noAdFlag === 'boolean') noAdFlag = data.noAdFlag;
      } catch (e) {
        /* bỏ qua */
      }
    },
    true
  );
})();
