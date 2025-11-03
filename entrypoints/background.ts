// entrypoints/background.ts

/**
 * 监听来自 content script 的消息
 */
export default defineBackground(() => {
  browser.runtime.onMessage.addListener(
    (
      message: any,
      sender: Browser.runtime.MessageSender,
      sendResponse: (response?: any) => void
    ): boolean => {
      // --- 1. 下载处理器 ---
      if (message.type === "downloadImage") {
        const { url, savePath } = message;
        console.log(`Background: 收到下载请求 ${savePath} (来自: ${url})`);

        browser.downloads.download(
          {
            url: url,
            filename: savePath, // WXT 会自动处理路径
            conflictAction: "overwrite",
          },
          (downloadId?: number) => {
            // downloadId 可能是 undefined

            if (browser.runtime.lastError) {
              const errorMsg = `下载失败: ${savePath} - ${browser.runtime.lastError.message}`;
              console.error("Background:", errorMsg);
              sendResponse({
                success: false,
                error: browser.runtime.lastError.message,
                savePath: savePath,
              });
            } else if (downloadId === undefined) {
              // 这种情况也可能发生，例如 URL 无效
              const errorMsg = `下载失败: ${savePath} - 未知错误 (downloadId is undefined)`;
              console.error("Background:", errorMsg);
              sendResponse({
                success: false,
                error: "未知错误 (downloadId is undefined)",
                savePath: savePath,
              });
            } else {
              // 下载任务已创建
              sendResponse({
                success: true,
                downloadId: downloadId,
                savePath: savePath,
              });
            }
          }
        );

        return true; // 保持消息通道开启，以进行异步 sendResponse
      }

      // --- 2. tid 获取器 ---
      if (message.type === "getTid") {
        if (!sender.tab?.id) {
          console.error("getTid 请求没有 sender.tab.id");
          sendResponse({ error: "No sender.tab.id" });
          return false; // 同步返回
        }

        browser.scripting.executeScript(
          {
            target: { tabId: sender.tab.id },
            func: () => {
              // 这个函数在页面的上下文中运行
              // 我们需要告诉 TS，window 上可能存在 tid
              return (window as any).tid;
            },
          },
          (injectionResults?: Browser.scripting.InjectionResult[]) => {
            // injectionResults 可能是 undefined

            if (browser.runtime.lastError) {
              console.error("获取TID失败:", browser.runtime.lastError.message);
              sendResponse({ error: browser.runtime.lastError.message });
            } else if (injectionResults && injectionResults.length > 0) {
              // 脚本的返回值在 .result 属性中
              sendResponse({ tid: injectionResults[0].result });
            } else {
              // 没有结果（例如，脚本在页面中执行失败）
              sendResponse({ tid: null });
            }
          }
        );

        return true; // 保持消息通道开启，以进行异步 sendResponse
      }

      // 可选：处理未知的消息类型
      console.warn("未处理的消息类型:", message.type);
      return false; // 同步返回
    }
  );

  /**
   * 插件安装时的回调
   */
  browser.runtime.onInstalled.addListener(() => {
    console.log("S1 Markdown Exporter 插件已安装。 (TS version)");
  });
});
