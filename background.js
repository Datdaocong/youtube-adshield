// Bấm icon extension -> mở trang cài đặt.
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage();
});
