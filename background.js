// S1-Exporter-Plugin/background.js

// --- 1. 下载处理器 ---
// 监听来自 content_script 的下载请求
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'downloadImage') {
    chrome.downloads.download({
      url: message.url,
      filename: message.savePath,
      conflictAction: 'overwrite' // 如果文件已存在，则覆盖
    }, (downloadId) => {
      if (chrome.runtime.lastError) {
        console.error('下载失败:', message.savePath, chrome.runtime.lastError.message);
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        // console.log('下载任务已创建:', downloadId, message.savePath);
        // 插件无法轻易知道下载何时 *完成*，
        // 但我们可以假设任务创建即为“成功”并继续
        sendResponse({ success: true, downloadId: downloadId });
      }
    });
    // 必须返回 true，因为我们要异步发送响应
    return true; 
  }

  // --- 2. tid 获取器 ---
  // 监听来自 content_script 的获取 tid 的请求
  if (message.type === 'getTid') {
    // 向发送消息的标签页注入一个脚本，该脚本可以访问页面的 window.tid
    chrome.scripting.executeScript({
      target: { tabId: sender.tab.id },
      func: () => {
          // 这个函数在 *页面* 的上下文中运行
          return window.tid; 
      }
    }, (injectionResults) => {
      if (chrome.runtime.lastError) {
        console.error('获取TID失败:', chrome.runtime.lastError.message);
        sendResponse({ error: chrome.runtime.lastError.message });
      } else if (injectionResults && injectionResults.length > 0) {
        sendResponse({ tid: injectionResults[0].result });
      } else {
        sendResponse({ tid: null });
      }
    });
    // 异步
    return true;
  }
});

// 首次安装时可以打个招呼
chrome.runtime.onInstalled.addListener(() => {
  console.log('S1 Markdown Exporter 插件已安装。');
});