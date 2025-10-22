// S1-Exporter-Plugin/background.js

// --- 1. 下载处理器 ---
// 监听来自 content_script 的下载请求
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'downloadImage') {
    console.log(`Background: Received download request for ${message.savePath} from ${message.url}`); // 添加日志
    chrome.downloads.download({
      url: message.url,
      filename: message.savePath, // 这个路径是相对于默认下载文件夹的
      conflictAction: 'overwrite'
    }, (downloadId) => {
      // ** 关键改动：检查 lastError **
      if (chrome.runtime.lastError) {
        const errorMsg = `下载失败: ${message.savePath} - ${chrome.runtime.lastError.message}`;
        console.error('Background:', errorMsg);
        // ** 把错误信息发送回去 **
        sendResponse({ success: false, error: chrome.runtime.lastError.message, savePath: message.savePath });
      } else if (downloadId === undefined) {
        // 有时即使没有 lastError，downloadId 也可能是 undefined (例如 URL 无效)
        const errorMsg = `下载失败: ${message.savePath} - 未知错误 (downloadId is undefined)`;
        console.error('Background:', errorMsg);
        sendResponse({ success: false, error: '未知错误 (downloadId is undefined)', savePath: message.savePath });
      }
      else {
        // console.log('Background: 下载任务已创建:', downloadId, message.savePath);
        // ** 明确发送成功状态和路径回去 **
        sendResponse({ success: true, downloadId: downloadId, savePath: message.savePath });
      }
    });
    return true; // 保持异步
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