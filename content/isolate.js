/*
 * YT AdShield v1.2 – isolated-world script.
 * - Nạp cấu hình từ trang options (chrome.storage) và bơm vào main world.
 * - Bơm CSS ẩn quảng cáo (bật/tắt được lúc chạy).
 * - Tự đóng hộp thoại "phát hiện ad-block" / "bị gián đoạn" / upsell Premium,
 *   giữ video phát.
 * - SponsorBlock: tự bỏ qua phân đoạn tài trợ/tự quảng bá/kêu gọi tương tác
 *   (dữ liệu cộng đồng, lấy qua background service worker).
 * - Nhận thống kê từ main world và gửi lên background để hiện badge.
 */
(() => {
  'use strict';

  const DEFAULTS = {
    cosmetic: true,
    killEnforcement: true,
    autoPlay: true,
    noAdFlag: true,
    extraKeys: [],
    sbEnabled: true,
    sbCategories: ['sponsor', 'selfpromo', 'interaction'],
    extraDomains: [],
  };

  const CATEGORY_LABELS = {
    sponsor: 'Nhà tài trợ',
    selfpromo: 'Tự quảng bá',
    interaction: 'Kêu gọi tương tác',
    intro: 'Mở đầu',
    outro: 'Kết thúc',
    preview: 'Xem trước / tóm tắt',
  };

  const CSS = `
#player-ads,
ytd-companion-slot-renderer,
ytd-action-companion-ad-renderer,
ytd-player-legacy-desktop-watch-ads-renderer,
ytd-ads-engagement-panel-content-renderer,
#masthead-ad,
ytd-video-masthead-ad-v3-renderer,
ytd-banner-promo-renderer,
ytd-ad-slot-renderer,
ytd-display-ad-renderer,
ytd-in-feed-ad-layout-renderer,
ytd-carousel-ad-renderer,
ytd-brand-video-singleton-renderer,
ytd-brand-video-shelf-renderer,
ytd-rich-section-renderer:has(ytd-ad-slot-renderer),
ytd-rich-section-renderer:has(ytd-display-ad-renderer),
ytd-rich-item-renderer:has(> #content > ytd-ad-slot-renderer),
ytd-rich-shelf-renderer:has(ytd-display-ad-renderer),
ytd-search-pyv-renderer,
ytd-video-renderer:has(ytd-ad-slot-renderer),
ytd-compact-video-renderer:has(ytd-ad-slot-renderer),
ytd-mealbar-promo-renderer,
ytd-popup-container tp-yt-paper-dialog:has(yt-mealbar-promo-renderer),
ytd-inline-survey-renderer,
ytd-enforcement-message-view-model,
ytm-promoted-video-renderer,
ytm-companion-slot,
ytm-companion-ad-renderer {
  display: none !important;
}
`;

  const ENFORCEMENT_SELECTOR = 'ytd-enforcement-message-view-model';
  const BACKDROP_SELECTOR = 'tp-yt-iron-overlay-backdrop';
  const PREMIUM_UPSELL_SELECTOR =
    'ytd-popup-container tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)';
  const INTERRUPTION_RE = /experiencing interruptions|bị gián đoạn|gián đoạn khi phát/i;

  let config = { ...DEFAULTS };
  let styleEl = null;
  let lastHit = 0;

  // ---- CSS ẩn quảng cáo (bật/tắt được) ----
  const applyCosmetic = () => {
    if (config.cosmetic) {
      if (!styleEl || !styleEl.isConnected) {
        styleEl = document.createElement('style');
        styleEl.id = 'yt-adshield-cosmetic';
        styleEl.textContent = CSS;
        (document.head || document.documentElement || document).appendChild(styleEl);
      }
    } else if (styleEl) {
      styleEl.remove();
      styleEl = null;
    }
  };

  // ---- Bridge cấu hình sang main world ----
  const sendConfig = () => {
    try {
      window.postMessage(
        {
          __ytadshield: true,
          extraKeys: Array.isArray(config.extraKeys) ? config.extraKeys : [],
          noAdFlag: config.noAdFlag !== false,
        },
        '*'
      );
    } catch (e) {
      /* bỏ qua */
    }
  };

  // ---- Thống kê từ main world -> badge (gộp mỗi 2s cho nhẹ) ----
  let pendingStat = 0;
  let statTimer = null;
  window.addEventListener(
    'message',
    (event) => {
      if (event.source !== window) return;
      const data = event.data;
      if (!data || data.__ytadshieldStat !== true) return;
      if (typeof data.delta !== 'number' || data.delta <= 0) return;
      pendingStat += Math.min(data.delta, 500);
      if (!statTimer) statTimer = setTimeout(flushStat, 2000);
    },
    true
  );
  const flushStat = () => {
    statTimer = null;
    const delta = pendingStat;
    pendingStat = 0;
    if (delta <= 0) return;
    try {
      chrome.runtime.sendMessage({ type: 'ytadshield:stat', delta }, () => {
        void chrome.runtime.lastError;
      });
    } catch (e) {
      /* bỏ qua */
    }
  };

  // ---- Dọn hộp thoại chống-adblock & giữ video phát ----
  const keepPlaying = () => {
    for (const video of document.querySelectorAll('video')) {
      if (video.paused && !document.hidden && video.readyState > 0) {
        try {
          const p = video.play();
          if (p && p.catch) p.catch(() => {});
        } catch (e) {
          /* bỏ qua */
        }
      }
    }
  };

  const sweep = () => {
    if (!config.killEnforcement) return;
    let removed = false;

    for (const node of document.querySelectorAll(ENFORCEMENT_SELECTOR)) {
      node.remove();
      removed = true;
    }
    for (const node of document.querySelectorAll(PREMIUM_UPSELL_SELECTOR)) {
      node.remove();
      removed = true;
    }
    // Hộp thoại "Experiencing interruptions?" (đi kèm cơ chế fake buffering).
    for (const dlg of document.querySelectorAll(
      'ytd-popup-container tp-yt-paper-dialog, ytd-popup-container ytd-dialog'
    )) {
      try {
        const text = dlg.textContent || '';
        if (text.length < 500 && INTERRUPTION_RE.test(text)) {
          dlg.remove();
          removed = true;
        }
      } catch (e) {
        /* bỏ qua */
      }
    }
    if (removed) {
      lastHit = Date.now();
      for (const node of document.querySelectorAll(BACKDROP_SELECTOR)) node.remove();
      if (document.body) document.body.style.removeProperty('overflow');
      if (document.documentElement) document.documentElement.style.removeProperty('overflow');
      if (config.autoPlay) keepPlaying();
    }
  };

  let scheduled = false;
  const observer = new MutationObserver(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      sweep();
    });
  });

  const start = () => {
    observer.observe(document.documentElement || document, { childList: true, subtree: true });
    applyCosmetic();
    sweep();
    refreshSegments();
  };
  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });

  // Nếu player vẫn cố pause khi vừa có cảnh báo -> phát lại ngay.
  document.addEventListener(
    'pause',
    (event) => {
      if (!config.autoPlay || Date.now() - lastHit > 15000) return;
      const video = event.target;
      if (video && video.tagName === 'VIDEO') {
        setTimeout(() => {
          try {
            video.play();
          } catch (e) {
            /* bỏ qua */
          }
        }, 60);
      }
    },
    true
  );

  // Vòng dự phòng trong 2 phút sau lần gần nhất phát hiện cảnh báo.
  setInterval(() => {
    if (Date.now() - lastHit > 120000) return;
    if (config.killEnforcement && document.querySelector(ENFORCEMENT_SELECTOR)) sweep();
    else if (config.autoPlay && Date.now() - lastHit < 15000) keepPlaying();
  }, 1000);

  // ==================== SponsorBlock: tự bỏ qua phân đoạn ====================
  let videoId = '';
  let segments = [];

  const getVideoId = () => {
    try {
      const v = new URLSearchParams(location.search).get('v');
      if (v) return v;
      const m = location.pathname.match(/^\/shorts\/([\w-]{5,})/);
      return m ? m[1] : '';
    } catch (e) {
      return '';
    }
  };

  const activeCategories = () =>
    config.sbEnabled && Array.isArray(config.sbCategories) ? config.sbCategories : [];

  const refreshSegments = () => {
    videoId = getVideoId();
    segments = [];
    const cats = activeCategories();
    if (!config.sbEnabled || !videoId || cats.length === 0) return;
    try {
      const res = chrome.runtime.sendMessage({
        type: 'ytadshield:getSegments',
        videoId,
        categories: cats,
      });
      Promise.resolve(res)
        .then((reply) => {
          if (reply && Array.isArray(reply.segments) && getVideoId() === videoId) {
            segments = reply.segments;
          }
        })
        .catch(() => {});
    } catch (e) {
      /* bỏ qua */
    }
  };

  let toastEl = null;
  let toastTimer = null;
  const showToast = (category) => {
    try {
      if (!toastEl || !toastEl.isConnected) {
        toastEl = document.createElement('div');
        toastEl.id = 'yt-adshield-toast';
        toastEl.style.cssText =
          'position:fixed;left:16px;bottom:16px;z-index:2147483647;' +
          'background:rgba(24,24,24,.95);color:#fff;padding:10px 14px;border-radius:8px;' +
          'font:13px/1.4 system-ui,"Segoe UI",sans-serif;box-shadow:0 4px 14px rgba(0,0,0,.4);' +
          'opacity:0;transition:opacity .25s;pointer-events:none;';
        (document.body || document.documentElement).appendChild(toastEl);
      }
      toastEl.textContent = '⏩ Đã bỏ qua: ' + (CATEGORY_LABELS[category] || category);
      toastEl.style.opacity = '1';
      clearTimeout(toastTimer);
      toastTimer = setTimeout(() => {
        if (toastEl) toastEl.style.opacity = '0';
      }, 2500);
    } catch (e) {
      /* bỏ qua */
    }
  };

  let lastSkipAt = 0;
  const onTimeUpdate = (event) => {
    if (!segments.length || Date.now() - lastSkipAt < 300) return;
    const video = event.target;
    if (!video || video.tagName !== 'VIDEO' || !video.duration || video.paused) return;
    if (!video.classList.contains('html5-main-video')) return;
    if (video.closest('ytd-inline-preview-player')) return;

    const t = video.currentTime;
    for (const seg of segments) {
      if (t >= seg.start - 0.25 && t < seg.end - 0.35 && seg.end < video.duration - 0.4) {
        lastSkipAt = Date.now();
        try {
          video.currentTime = seg.end + 0.05;
        } catch (e) {
          return;
        }
        showToast(seg.category);
        break;
      }
    }
  };
  document.addEventListener('timeupdate', onTimeUpdate, true);
  document.addEventListener('yt-navigate-finish', refreshSegments, true);

  // ---- Nạp + theo dõi cấu hình ----
  const load = () => {
    try {
      chrome.storage.sync.get(DEFAULTS, (items) => {
        config = Object.assign({}, DEFAULTS, items || {});
        applyCosmetic();
        sendConfig();
        refreshSegments();
      });
    } catch (e) {
      applyCosmetic();
      sendConfig();
    }
  };
  load();

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'sync') return;
      for (const [key, change] of Object.entries(changes)) config[key] = change.newValue;
      applyCosmetic();
      sendConfig();
      refreshSegments();
    });
  } catch (e) {
    /* bỏ qua */
  }
})();
