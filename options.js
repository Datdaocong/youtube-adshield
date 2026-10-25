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

  const $ = (id) => document.getElementById(id);
  const catBoxes = () => Array.from(document.querySelectorAll('input[data-cat]'));
  const lines = (value) =>
    String(value || '')
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

  const syncCatState = () => {
    const enabled = $('sbEnabled').checked;
    for (const box of catBoxes()) {
      box.disabled = !enabled;
      box.closest('label').classList.toggle('off', !enabled);
    }
  };

  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    const config = Object.assign({}, DEFAULTS, cfg || {});
    $('cosmetic').checked = config.cosmetic !== false;
    $('killEnforcement').checked = config.killEnforcement !== false;
    $('autoPlay').checked = config.autoPlay !== false;
    $('noAdFlag').checked = config.noAdFlag !== false;
    $('sbEnabled').checked = config.sbEnabled !== false;
    $('extraKeys').value = (config.extraKeys || []).join('\n');
    $('extraDomains').value = (config.extraDomains || []).join('\n');
    const cats = new Set(config.sbCategories || []);
    for (const box of catBoxes()) box.checked = cats.has(box.dataset.cat);
    syncCatState();
  });

  chrome.storage.local.get({ totalBlocked: 0 }, ({ totalBlocked }) => {
    $('total').textContent = Number(totalBlocked || 0).toLocaleString('vi-VN');
  });

  $('sbEnabled').addEventListener('change', syncCatState);

  $('save').addEventListener('click', () => {
    chrome.storage.sync.set(
      {
        cosmetic: $('cosmetic').checked,
        killEnforcement: $('killEnforcement').checked,
        autoPlay: $('autoPlay').checked,
        noAdFlag: $('noAdFlag').checked,
        sbEnabled: $('sbEnabled').checked,
        sbCategories: catBoxes().filter((b) => b.checked).map((b) => b.dataset.cat),
        extraDomains: lines($('extraDomains').value),
        extraKeys: lines($('extraKeys').value),
      },
      () => {
        const status = $('status');
        status.classList.add('show');
        setTimeout(() => status.classList.remove('show'), 1800);
      }
    );
  });
})();
