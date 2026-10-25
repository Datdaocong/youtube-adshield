/*
 * YT AdShield v1.1 – main-world script (chạy TRƯỚC mọi script của YouTube,
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
 */
(() => {
  'use strict';

  const AD_KEYS = new Set(['adPlacements', 'adSlots', 'playerAds']);
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

  const prune = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 40) return;
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) {
        if (isShortsAdEntry(node[i])) {
          node.splice(i, 1);
          continue;
        }
        prune(node[i], depth + 1);
      }
      return;
    }
    for (const key in node) {
      if (!hasOwn.call(node, key)) continue;
      if (AD_KEYS.has(key)) {
        delete node[key];
        continue;
      }
      prune(node[key], depth + 1);
    }
  };

  // Marker để soát nhanh chuỗi JSON trước khi prune (tránh đi cây trên data không liên quan).
  // "reelWatchEndpoint" là dấu hiệu dữ liệu Shorts (quảng cáo Shorts đánh dấu qua isAd).
  const MARKERS = new Set(['"reelWatchEndpoint"']);
  for (const key of AD_KEYS) MARKERS.add('"' + key + '"');

  const hasMarker = (text) => {
    for (const marker of MARKERS) {
      if (text.includes(marker)) return true;
    }
    return false;
  };

  // ========== Bắt JSON.parse ==========
  const origParse = JSON.parse;
  const parsePatch = function parse(text, reviver) {
    const data = origParse.call(JSON, text, reviver);
    try {
      if (typeof text === 'string' && text.length < 20000000 && hasMarker(text)) prune(data);
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
      if (this.url && this.url.includes('/youtubei/')) prune(data);
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
          prune(this.response);
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
            if (value && typeof value === 'object') prune(value);
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

  // YouTube là SPA – sau mỗi lần điều hướng, kiểm tra lại bẫy và prune nốt dữ
  // liệu mới gán vào biến toàn cục.
  const rescrub = () => {
    try {
      trap('ytInitialPlayerResponse');
      trap('ytInitialData');
      const pr = window.ytInitialPlayerResponse;
      if (pr && typeof pr === 'object') prune(pr);
      if (window.ytInitialData && typeof window.ytInitialData === 'object') {
        prune(window.ytInitialData);
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
              MARKERS.add('"' + key + '"');
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
