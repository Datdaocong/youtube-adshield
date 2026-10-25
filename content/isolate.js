/*
 * YT AdShield v1.1 – isolated-world script.
 * - Nạp cấu hình từ trang options (chrome.storage) và bơm vào main world.
 * - Bơm CSS ẩn quảng cáo (bật/tắt được lúc chạy).
 * - Tự đóng hộp thoại "phát hiện ad-block" / upsell Premium, giữ video phát.
 */
(() => {
  'use strict';

  const DEFAULTS = {
    cosmetic: true,
    killEnforcement: true,
    autoPlay: true,
    noAdFlag: true,
    extraKeys: [],
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

  // ---- Nạp + theo dõi cấu hình ----
  const load = () => {
    try {
      chrome.storage.sync.get(DEFAULTS, (items) => {
        config = Object.assign({}, DEFAULTS, items || {});
        applyCosmetic();
        sendConfig();
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
    });
  } catch (e) {
    /* bỏ qua */
  }
})();
