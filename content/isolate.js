/*
 * YT AdShield – isolated-world script.
 * Dọn phần mà CSS không đủ: tự đóng hộp thoại "phát hiện ad-block", nhả khoá
 * cuộn trang, và giữ cho video phát tiếp nếu player vẫn cố dừng lại.
 */
(() => {
  'use strict';

  const ENFORCEMENT_SELECTOR = 'ytd-enforcement-message-view-model';
  const BACKDROP_SELECTOR = 'tp-yt-iron-overlay-backdrop';
  const PREMIUM_UPSELL_SELECTOR =
    'ytd-popup-container tp-yt-paper-dialog:has(yt-mealbar-promo-renderer)';

  let lastHit = 0;

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
      // backdrop mờ + khoá cuộn do hộp thoại để lại
      for (const node of document.querySelectorAll(BACKDROP_SELECTOR)) node.remove();
      if (document.body) document.body.style.removeProperty('overflow');
      if (document.documentElement) document.documentElement.style.removeProperty('overflow');
      keepPlaying();
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
    sweep();
  };
  if (document.documentElement) start();
  else document.addEventListener('readystatechange', start, { once: true });

  // Nếu player vẫn cố pause khi đang hiện cảnh báo -> phát lại ngay
  document.addEventListener(
    'pause',
    (event) => {
      if (Date.now() - lastHit > 15000) return;
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

  // Vòng dự phòng trong 2 phút sau lần gần nhất phát hiện cảnh báo
  setInterval(() => {
    if (Date.now() - lastHit > 120000) return;
    if (document.querySelector(ENFORCEMENT_SELECTOR)) sweep();
    else if (Date.now() - lastHit < 15000) keepPlaying();
  }, 1000);
})();
