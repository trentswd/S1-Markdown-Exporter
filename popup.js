// S1-Exporter-Plugin/popup.js

document.addEventListener('DOMContentLoaded', () => {
  const exportButton = document.getElementById('exportButton');
  const statusEl = document.getElementById('status');
  let currentTab = null;

  // 1. 查询当前活动的 S1 标签页
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs.length === 0) {
      statusEl.textContent = '错误：找不到活动标签页。';
      exportButton.disabled = true;
      return;
    }
    
    currentTab = tabs[0];
    
    // 检查是否在 S1 页面
    const isS1Page = currentTab.url && (
      currentTab.url.includes('stage1st.com/2b/thread-') ||
      currentTab.url.includes('stage1st.com/2b/forum.php') ||
      currentTab.url.includes('bbs.saraba1st.com/2b/thread-') ||
      currentTab.url.includes('bbs.saraba1st.com/2b/forum.php')
    );

    if (isS1Page) {
      statusEl.textContent = '准备就绪。';
      exportButton.disabled = false;
    } else {
      statusEl.textContent = '请在 S1 帖子页面使用。';
      exportButton.disabled = true;
    }
  });

  // 2. 监听按钮点击
  exportButton.addEventListener('click', () => {
    if (!currentTab) return;

    exportButton.disabled = true;
    exportButton.textContent = '处理中...';
    statusEl.textContent = '已发送命令，请查看网页...';

    // 3. 向 content_script 发送“开始”消息
    chrome.tabs.sendMessage(currentTab.id, { type: "startExport" }, (response) => {
      if (chrome.runtime.lastError) {
        statusEl.textContent = '错误：脚本未注入。请刷新S1页面后重试。';
        console.error(chrome.runtime.lastError.message);
        exportButton.textContent = '开始导出';
        exportButton.disabled = false; // 允许重试
      } else if (response && response.status === 'started') {
        statusEl.textContent = '导出已开始！';
        setTimeout(() => window.close(), 1000); // 1秒后自动关闭弹出窗口
      } else if (response && response.status === 'already_running') {
        statusEl.textContent = '导出已在运行中...';
        setTimeout(() => window.close(), 1000);
      } else {
         statusEl.textContent = '未知响应。';
      }
    });
  });
});