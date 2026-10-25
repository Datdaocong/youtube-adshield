/*
 * YT AdShield – main-world script (chạy TRƯỚC mọi script của YouTube).
 *
 * Nguyên tắc "không bị phát hiện": không "đối đầu" sau khi quảng cáo đã render,
 * mà xoá dữ liệu quảng cáo (adPlacements, adSlots, playerAds, adBreaks)
 * khỏi mọi phản hồi JSON ngay từ đầu để player của YouTube không bao giờ
 * nhận lệnh chèn quảng cáo -> với YouTube thì trang "như thể không có adblock".
 */
(() => {
  'use strict';

  const AD_KEYS = new Set([
    'adPlacements',
    'adSlots',
    'playerAds',
    'adBreaks',
    'adBreakHeartbeatParams',
    'adParams',
  ]);

  const MARKERS = ['"adPlacements"', '"adSlots"', '"playerAds"', '"adBreaks"'];

  const hasMarker = (s) => MARKERS.some((m) => s.includes(m));

  const prune = (node, depth = 0) => {
    if (!node || typeof node !== 'object' || depth > 25) return;
    if (Array.isArray(node)) {
      for (const item of node) prune(item, depth + 1);
      return;
    }
    for (const key in node) {
      if (!Object.prototype.hasOwnProperty.call(node, key)) continue;
      if (AD_KEYS.has(key)) {
        delete node[key];
        continue;
      }
      prune(node[key], depth + 1);
    }
  };

  // 1) Bắt JSON.parse – phần lớn dữ liệu Innertube đi qua đây.
  const origParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const data = origParse.call(JSON, text, reviver);
    try {
      if (typeof text === 'string' && text.length < 12000000 && hasMarker(text)) prune(data);
    } catch (e) {
      /* không bao giờ để lỗi làm vỡ trang */
    }
    return data;
  };

  // 2) Bắt Response.json() của fetch (Innertube gọi /youtubei/* qua fetch).
  const origJson = Response.prototype.json;
  Response.prototype.json = async function () {
    const data = await origJson.call(this);
    try {
      if (this.url && this.url.includes('/youtubei/')) prune(data);
    } catch (e) {
      /* bỏ qua */
    }
    return data;
  };

  // 3) Bắt XMLHttpRequest (dự phòng cho code cũ dùng XHR + responseType json).
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ytAdUrl = String(url || '');
    return origOpen.apply(this, [method, url, ...rest]);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
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

  // 4) Đặt bẫy cho biến toàn cục mà trang nhúng trực tiếp (object literal)
  //    trong HTML – những dữ liệu này KHÔNG đi qua JSON.parse.
  const trap = (name) => {
    try {
      let holder;
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
    } catch (e) {
      /* bỏ qua */
    }
  };
  trap('ytInitialPlayerResponse');
  trap('ytInitialData');
})();
