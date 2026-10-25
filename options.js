(() => {
  'use strict';

  const DEFAULTS = {
    cosmetic: true,
    killEnforcement: true,
    autoPlay: true,
    noAdFlag: true,
    extraKeys: [],
  };

  const $ = (id) => document.getElementById(id);

  chrome.storage.sync.get(DEFAULTS, (cfg) => {
    const config = Object.assign({}, DEFAULTS, cfg || {});
    $('cosmetic').checked = config.cosmetic !== false;
    $('killEnforcement').checked = config.killEnforcement !== false;
    $('autoPlay').checked = config.autoPlay !== false;
    $('noAdFlag').checked = config.noAdFlag !== false;
    $('extraKeys').value = (config.extraKeys || []).join('\n');
  });

  $('save').addEventListener('click', () => {
    const extraKeys = $('extraKeys').value
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    chrome.storage.sync.set(
      {
        cosmetic: $('cosmetic').checked,
        killEnforcement: $('killEnforcement').checked,
        autoPlay: $('autoPlay').checked,
        noAdFlag: $('noAdFlag').checked,
        extraKeys,
      },
      () => {
        const status = $('status');
        status.classList.add('show');
        setTimeout(() => status.classList.remove('show'), 1800);
      }
    );
  });
})();
