// S1-Exporter-Plugin/popup.js 

document.addEventListener('DOMContentLoaded', () => {
  const exportButton = document.getElementById('exportButton');
  const statusEl = document.getElementById('status');
  const startFloorInput = document.getElementById('startFloor');
  const endFloorInput = document.getElementById('endFloor');
  const postsPerPageInput = document.getElementById('postsPerPage');
  const downloadImagesCheckbox = document.getElementById('downloadImages'); 
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

  // 2. 监听按钮点击 (修改：读取并发送选项)
  exportButton.addEventListener('click', () => {
    if (!currentTab) return;

    // --- ** 读取选项值 ** ---
    const startFloorStr = startFloorInput.value;
    const endFloorStr = endFloorInput.value;
    const postsPerPageStr = postsPerPageInput.value;
    const downloadImages = downloadImagesCheckbox.checked;
    const linkFormat = document.querySelector('input[name="linkFormat"]:checked').value;

    // 转换为数字，留空则为 null
    let startFloor = startFloorStr ? parseInt(startFloorStr, 10) : null;
    let endFloor = endFloorStr ? parseInt(endFloorStr, 10) : null;
    let postsPerPage = postsPerPageStr ? parseInt(postsPerPageStr, 10) : 40; // ** 新增 **

    // 基本验证
    if (startFloor !== null && isNaN(startFloor)) startFloor = null; // 非数字视为无效
    if (endFloor !== null && isNaN(endFloor)) endFloor = null;
    if (startFloor !== null && startFloor < 1) startFloor = 1; // 最小楼层为 1
    if (endFloor !== null && endFloor < 1) endFloor = null; // 结束楼层小于 1 无意义
    if (isNaN(postsPerPage) || postsPerPage < 1) {
        postsPerPage = 40; // ** 新增：无效则用默认值 **
        console.warn("Invalid postsPerPage, defaulting to 40.");
    }

    // 检查范围是否有效
    if (startFloor !== null && endFloor !== null && startFloor > endFloor) {
      statusEl.textContent = '错误：起始楼层不能大于结束楼层！';
      return; // 阻止发送消息
    }

    // --- ** 准备发送的消息 ** ---
    const options = {
      startFloor: startFloor,
      endFloor: endFloor,
      postsPerPage: postsPerPage,
      downloadImages: downloadImages,
      linkFormat: linkFormat
    };

    console.log("Sending export options:", options); // 调试日志

    exportButton.disabled = true;
    exportButton.textContent = '处理中...';
    statusEl.textContent = '已发送命令，请查看网页...';

    // 3. 向 content_script 发送“开始”消息，并附带选项
    chrome.tabs.sendMessage(currentTab.id, { type: "startExport", options: options }, (response) => {
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