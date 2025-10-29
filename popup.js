// S1-Exporter-Plugin/popup.js (V3.9 - Settings Save/Load)

document.addEventListener('DOMContentLoaded', () => {
  // --- 1. 获取所有表单元素 ---
  const exportButton = document.getElementById('exportButton');
  const statusEl = document.getElementById('status');
  const startFloorInput = document.getElementById('startFloor');
  const endFloorInput = document.getElementById('endFloor');
  const postsPerPageInput = document.getElementById('postsPerPage');
  const downloadImagesCheckbox = document.getElementById('downloadImages');
  const postsPerFileInput = document.getElementById('postsPerFile');
  const startFileInput = document.getElementById('startFile');
  const endFileInput = document.getElementById('endFile');
  
  let currentTab = null;
  let currentTid = null; // [新增] 用于存储当前页面的TID
  const STORAGE_KEY_PREFIX = 's1_exporter_settings_';

  // --- 2. [新增] 辅助函数：加载设置到表单 ---
  function loadSettingsToForm(settings) {
    if (!settings) {
      console.log("No saved settings found, using defaults.");
      return;
    }
    console.log("Loading saved settings:", settings);
    
    // 使用 ?? 运算符，如果设置中没有该值，则保留为空或默认
    startFloorInput.value = settings.startFloor ?? '';
    endFloorInput.value = settings.endFloor ?? '';
    postsPerPageInput.value = settings.postsPerPage ?? 40;
    downloadImagesCheckbox.checked = settings.downloadImages ?? true;
    
    // 确保 radio 按钮被正确选中
    document.querySelector(`input[name="linkFormat"][value="${settings.linkFormat ?? 'obsidian'}"]`).checked = true;
    document.querySelector(`input[name="emoteFormat"][value="${settings.emoteFormat ?? 'obsidian'}"]`).checked = true;
    
    postsPerFileInput.value = settings.postsPerFile ?? '';
    startFileInput.value = settings.startFile ?? '';
    endFileInput.value = settings.endFile ?? '';
  }

  // --- 3. [新增] 辅助函数：从表单读取设置 ---
  function readOptionsFromForm() {
    // 读取所有值
    const startFloorStr = startFloorInput.value;
    const endFloorStr = endFloorInput.value;
    const postsPerPageStr = postsPerPageInput.value;
    const downloadImages = downloadImagesCheckbox.checked;
    const linkFormat = document.querySelector('input[name="linkFormat"]:checked').value;
    const emoteFormat = document.querySelector('input[name="emoteFormat"]:checked').value;
    const postsPerFileStr = postsPerFileInput.value;
    const startFileStr = startFileInput.value;
    const endFileStr = endFileInput.value;

    // 转换为数字，留空则为 null
    let startFloor = startFloorStr ? parseInt(startFloorStr, 10) : null;
    let endFloor = endFloorStr ? parseInt(endFloorStr, 10) : null;
    let postsPerPage = postsPerPageStr ? parseInt(postsPerPageStr, 10) : 40;
    let postsPerFile = postsPerFileStr ? parseInt(postsPerFileStr, 10) : null;
    let startFile = startFileStr ? parseInt(startFileStr, 10) : null;
    let endFile = endFileStr ? parseInt(endFileStr, 10) : null;

    // 基本验证
    if (startFloor !== null && isNaN(startFloor)) startFloor = null;
    if (endFloor !== null && isNaN(endFloor)) endFloor = null;
    if (startFloor !== null && startFloor < 1) startFloor = 1;
    if (endFloor !== null && endFloor < 1) endFloor = null;
    if (isNaN(postsPerPage) || postsPerPage < 1) postsPerPage = 40;
    if (postsPerFile !== null && (isNaN(postsPerFile) || postsPerFile < 1)) postsPerFile = null;
    if (startFile !== null && (isNaN(startFile) || startFile < 1)) startFile = null;
    if (endFile !== null && (isNaN(endFile) || endFile < 1)) endFile = null;

    // 检查范围是否有效
    if (startFloor !== null && endFloor !== null && startFloor > endFloor) {
      statusEl.textContent = '错误：起始楼层不能大于结束楼层！';
      return null; // 返回 null 表示验证失败
    }
    if (startFile !== null && endFile !== null && startFile > endFile) {
      statusEl.textContent = '错误：起始文件页不能大于结束文件页！';
      return null; // 返回 null 表示验证失败
    }

    // [修改] 返回一个完整的 options 对象
    return {
      startFloor: startFloor,
      endFloor: endFloor,
      postsPerPage: postsPerPage,
      downloadImages: downloadImages,
      linkFormat: linkFormat,
      emoteFormat: emoteFormat,
      postsPerFile: postsPerFile,
      startFile: startFile,
      endFile: endFile
    };
  }

  // --- 4. [修改] 插件加载时的逻辑 ---
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
      // [修改] 页面正确，向 content_script 请求TID和设置
      exportButton.disabled = true; // 默认禁用，等待响应
      statusEl.textContent = '正在加载设置...';

      chrome.tabs.sendMessage(currentTab.id, { type: "getTidAndSettings" }, (response) => {
        if (chrome.runtime.lastError) {
          statusEl.textContent = '错误：脚本未注入。请刷新S1页面后重试。';
          console.error(chrome.runtime.lastError.message);
          return;
        }

        if (response && response.tid) {
          currentTid = response.tid; // [新增] 保存TID
          console.log(`[Popup] Received TID: ${currentTid}`);
          if (response.settings) {
            loadSettingsToForm(response.settings); // 加载设置
            statusEl.textContent = '已加载本帖设置。';
          } else {
            statusEl.textContent = '准备就绪 (无本帖设置)。';
          }
          exportButton.disabled = false; // 准备就绪，启用按钮
        } else {
          statusEl.textContent = '无法获取TID，将使用默认设置。';
          console.warn("Could not get TID from content script.", response?.error);
          exportButton.disabled = false; // 仍然启用，但无法保存
        }
      });
      
    } else {
      statusEl.textContent = '请在 S1 帖子页面使用。';
      exportButton.disabled = true;
    }
  });

  // --- 5. [修改] 导出按钮点击逻辑 ---
  exportButton.addEventListener('click', () => {
    if (!currentTab) return;

    // --- 1. 从表单读取选项 ---
    const options = readOptionsFromForm(); // 使用辅助函数
    
    if (options === null) {
      // 验证失败，readOptionsFromForm 已经设置了 statusEl
      return; 
    }

    // --- 2. [修改] 发送消息到 content_script.js 来保存选项 ---
    if (currentTid) {
      console.log(`[Popup] Sending save request for tid ${currentTid}...`);
      // 发送保存消息。我们不需要等待它完成，可以直接继续
      chrome.tabs.sendMessage(currentTab.id, { 
          type: "saveSettings", 
          tid: currentTid,
          options: options 
      }, (response) => {
          // 处理保存结果（可选，主要用于调试）
          if (chrome.runtime.lastError) {
              console.error("Save settings message failed:", chrome.runtime.lastError.message);
          } else if (response?.status === 'saved') {
              console.log("[Popup] Content script confirmed settings saved.");
          } else {
              console.warn("[Popup] Content script reported error saving settings:", response?.error);
          }
      });
    } else {
      console.warn("[Popup] No currentTid, settings will not be saved.");
    }

    console.log("Sending export options:", options); // 调试日志

    exportButton.disabled = true;
    exportButton.textContent = '处理中...';
    statusEl.textContent = '已发送命令，请查看网页...';

    // --- 3. 向 content_script 发送“开始”消息 ---
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
         exportButton.textContent = '开始导出';
         exportButton.disabled = false; // 允许重试
      }
    });
  });
});