/*
 * YT AdShield v1.2 – service worker.
 * - Badge đếm tổng số quảng cáo/dữ liệu đã bị cắt.
 * - Lấy + cache phân đoạn SponsorBlock cho tool bỏ qua.
 * - Đồng bộ rule chặn mạng động từ cấu hình "domain bổ sung".
 * - Bấm icon -> mở trang cài đặt.
 */

const DYN_RULE_BASE = 10000;
const SB_API = 'https://sponsor.ajay.app/api/skipSegments';
const SEG_CACHE = new Map();
const CACHE_TTL = 30 * 60 * 1000;

const compactBadge = (n) => {
  if (!n || n <= 0) return '';
  if (n < 1000) return String(n);
  if (n < 10000) return (Math.round(n / 100) / 10).toFixed(1).replace(/\.0$/, '') + 'k';
  if (n < 1000000) return Math.floor(n / 1000) + 'k';
  return (Math.round(n / 100000) / 10).toFixed(1).replace(/\.0$/, '') + 'm';
};

const updateBadge = () => {
  try {
    chrome.storage.local.get({ totalBlocked: 0 }, ({ totalBlocked }) => {
      chrome.action.setBadgeText({ text: compactBadge(totalBlocked) });
      chrome.action.setBadgeBackgroundColor({ color: [176, 0, 32] });
    });
  } catch (e) {
    /* bỏ qua */
  }
};

const sanitizeDomains = (list) =>
  (Array.isArray(list) ? list : [])
    .map((d) =>
      String(d || '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/[/:].*$/, '')
    )
    .filter((d) => /^[a-z0-9.-]{1,253}\.[a-z]{2,}$/.test(d))
    .filter((d, i, arr) => arr.indexOf(d) === i);

const syncDynamicRules = async () => {
  try {
    const { extraDomains } = await chrome.storage.sync.get({ extraDomains: [] });
    const domains = sanitizeDomains(extraDomains);
    const existing = await chrome.declarativeNetRequest.getDynamicRules();
    const removeRuleIds = existing.rules.map((r) => r.id).filter((id) => id >= DYN_RULE_BASE);
    const addRules = domains.map((domain, i) => ({
      id: DYN_RULE_BASE + i,
      priority: 1,
      action: { type: 'block' },
      condition: {
        urlFilter: '||' + domain + '^',
        resourceTypes: ['script', 'image', 'xmlhttprequest', 'sub_frame', 'ping', 'media', 'other'],
      },
    }));
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds, addRules });
  } catch (e) {
    /* bỏ qua */
  }
};

const fetchSegments = async (videoId, categories) => {
  const key = videoId + '|' + (categories || []).join(',');
  const cached = SEG_CACHE.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL) return cached.data;

  const url =
    SB_API +
    '?videoID=' +
    encodeURIComponent(videoId) +
    '&categories=' +
    encodeURIComponent(JSON.stringify(categories || []));
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const list = await res.json();

  const segments = (Array.isArray(list) ? list : [])
    .filter((s) => s && s.actionType === 'skip' && Array.isArray(s.segment) && s.segment.length === 2)
    .map((s) => ({
      start: Number(s.segment[0]),
      end: Number(s.segment[1]),
      category: String(s.category || ''),
    }))
    .filter(
      (s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start
    )
    .slice(0, 50);

  SEG_CACHE.set(key, { at: Date.now(), data: segments });
  if (SEG_CACHE.size > 200) SEG_CACHE.delete(SEG_CACHE.keys().next().value);
  return segments;
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === 'ytadshield:stat' && typeof msg.delta === 'number' && msg.delta > 0) {
    chrome.storage.local.get({ totalBlocked: 0 }, ({ totalBlocked }) => {
      const total = totalBlocked + msg.delta;
      chrome.storage.local.set({ totalBlocked: total }, updateBadge);
    });
    sendResponse(true);
    return;
  }
  if (msg && msg.type === 'ytadshield:getSegments' && typeof msg.videoId === 'string' && msg.videoId) {
    fetchSegments(msg.videoId, msg.categories)
      .then((segments) => sendResponse({ segments }))
      .catch(() => sendResponse({ segments: [] }));
    return true; // trả lời bất đồng bộ
  }
});

updateBadge();
syncDynamicRules();
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && changes.extraDomains) syncDynamicRules();
});
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
