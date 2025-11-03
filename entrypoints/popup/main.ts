// entrypoints/popup/index.ts
import './style.css';
import { browser } from "wxt/browser";

// --- 1. 定义类型接口 ---

/** 插件导出选项 */
interface ExportOptions {
  startFloor: number | null;
  endFloor: number | null;
  postsPerPage: number;
  downloadImages: boolean;
  linkFormat: 'obsidian' | 'standard';
  emoteFormat: 'obsidian' | 'standard';
  postsPerFile: number | null;
  startFile: number | null;
  endFile: number | null;
}

/** content_script.js (getTidAndSettings) 的响应类型 */
interface TidSettingsResponse {
  tid: string | null;
  settings: ExportOptions | null;
  error?: string;
}

/** content_script.js (saveSettings) 的响应类型 */
interface SaveSettingsResponse {
  status: 'saved' | 'error';
  error?: string;
}

/** content_script.js (startExport) 的响应类型 */
interface StartExportResponse {
  status: 'started' | 'already_running' | 'error';
  error?: string;
}


document.addEventListener('DOMContentLoaded', () => {
  // --- 2. 获取所有表单元素 (并添加类型) ---
  const exportButton = document.getElementById('exportButton') as HTMLButtonElement;
  const statusEl = document.getElementById('status') as HTMLDivElement;
  const startFloorInput = document.getElementById('startFloor') as HTMLInputElement;
  const endFloorInput = document.getElementById('endFloor') as HTMLInputElement;
  const postsPerPageInput = document.getElementById('postsPerPage') as HTMLInputElement;
  const downloadImagesCheckbox = document.getElementById('downloadImages') as HTMLInputElement;
  const postsPerFileInput = document.getElementById('postsPerFile') as HTMLInputElement;
  const startFileInput = document.getElementById('startFile') as HTMLInputElement;
  const endFileInput = document.getElementById('endFile') as HTMLInputElement;
  
  let currentTab: Browser.tabs.Tab | null = null;
  let currentTid: string | null = null;

  // --- 3. 辅助函数：加载设置到表单 ---
  function loadSettingsToForm(settings: ExportOptions | null) {
    if (!settings) {
      console.log("No saved settings found, using defaults.");
      return;
    }
    console.log("Loading saved settings:", settings);
    
    // 使用 ?. 和 ?? 运算符确保安全转换
    startFloorInput.value = settings.startFloor?.toString() ?? '';
    endFloorInput.value = settings.endFloor?.toString() ?? '';
    postsPerPageInput.value = settings.postsPerPage?.toString() ?? '40';
    downloadImagesCheckbox.checked = settings.downloadImages ?? true;
    
    const linkFormatInput = document.querySelector(`input[name="linkFormat"][value="${settings.linkFormat ?? 'obsidian'}"]`) as HTMLInputElement | null;
    if (linkFormatInput) linkFormatInput.checked = true;
    
    const emoteFormatInput = document.querySelector(`input[name="emoteFormat"][value="${settings.emoteFormat ?? 'obsidian'}"]`) as HTMLInputElement | null;
    if (emoteFormatInput) emoteFormatInput.checked = true;
    
    postsPerFileInput.value = settings.postsPerFile?.toString() ?? '';
    startFileInput.value = settings.startFile?.toString() ?? '';
    endFileInput.value = settings.endFile?.toString() ?? '';
  }

  // --- 4. 辅助函数：从表单读取设置 ---
  function readOptionsFromForm(): ExportOptions | null {
    const startFloorStr = startFloorInput.value;
    const endFloorStr = endFloorInput.value;
    const postsPerPageStr = postsPerPageInput.value;
    const downloadImages = downloadImagesCheckbox.checked;

    // 添加类型断言和空值检查
    const linkFormatEl = document.querySelector('input[name="linkFormat"]:checked') as HTMLInputElement | null;
    const emoteFormatEl = document.querySelector('input[name="emoteFormat"]:checked') as HTMLInputElement | null;

    const linkFormat = (linkFormatEl?.value ?? 'obsidian') as 'obsidian' | 'standard';
    const emoteFormat = (emoteFormatEl?.value ?? 'obsidian') as 'obsidian' | 'standard';

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

    return {
      startFloor,
      endFloor,
      postsPerPage,
      downloadImages,
      linkFormat,
      emoteFormat,
      postsPerFile,
      startFile,
      endFile
    };
  }

  // --- 5. [修改] 插件加载时的逻辑 (使用 async/await 和 Promise) ---
  browser.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
    if (tabs.length === 0) {
      statusEl.textContent = '错误：找不到活动标签页。';
      exportButton.disabled = true;
      return;
    }
    
    currentTab = tabs[0];
    const tabId = currentTab.id;
    
    const isS1Page = currentTab.url && (
      currentTab.url.includes('stage1st.com/2b/thread-') ||
      currentTab.url.includes('stage1st.com/2b/forum.php') ||
      currentTab.url.includes('bbs.saraba1st.com/2b/thread-') ||
      currentTab.url.includes('bbs.saraba1st.com/2b/forum.php')
    );

    if (isS1Page && tabId) {
      exportButton.disabled = true;
      statusEl.textContent = '正在加载设置...';

      try {
        const response = await browser.tabs.sendMessage(tabId, { type: "getTidAndSettings" }) as TidSettingsResponse;
        
        if (response && response.tid) {
          currentTid = response.tid;
          console.log(`[Popup] Received TID: ${currentTid}`);
          if (response.settings) {
            loadSettingsToForm(response.settings);
            statusEl.textContent = '已加载本帖设置。';
          } else {
            statusEl.textContent = '准备就绪 (无本帖设置)。';
          }
          exportButton.disabled = false; // 准备就绪，启用按钮
        } else {
          statusEl.textContent = '无法获取TID，将使用默认设置。';
          console.warn("Could not get TID from content script.", response?.error);
          exportButton.disabled = false;
        }
      } catch (e: any) {
        statusEl.textContent = '错误：脚本未注入。请刷新S1页面后重试。';
        console.error(e.message);
      }
      
    } else {
      statusEl.textContent = '请在 S1 帖子页面使用。';
      exportButton.disabled = true;
    }
  });

  // --- 6. [修改] 导出按钮点击逻辑 (使用 Promise) ---
  exportButton.addEventListener('click', () => {
    if (!currentTab || !currentTab.id) return;

    const options = readOptionsFromForm();
    if (options === null) {
      return; 
    }

    const tabId = currentTab.id;

    // --- 2. [修改] 发送消息到 content_script.js 来保存选项 ---
    if (currentTid) {
      console.log(`[Popup] Sending save request for tid ${currentTid}...`);
      browser.tabs.sendMessage(tabId, { 
          type: "saveSettings", 
          tid: currentTid,
          options: options 
      })
      .then((response: SaveSettingsResponse) => {
          if (response?.status === 'saved') {
              console.log("[Popup] Content script confirmed settings saved.");
          } else {
              console.warn("[Popup] Content script reported error saving settings:", response?.error);
          }
      })
      .catch((e: any) => {
          console.error("Save settings message failed:", e.message);
      });
    } else {
      console.warn("[Popup] No currentTid, settings will not be saved.");
    }

    console.log("Sending export options:", options);

    exportButton.disabled = true;
    exportButton.textContent = '处理中...';
    statusEl.textContent = '已发送命令，请查看网页...';

    // --- 3. 向 content_script 发送“开始”消息 ---
    browser.tabs.sendMessage(tabId, { type: "startExport", options: options })
      .then((response: StartExportResponse) => {
        if (response && response.status === 'started') {
          statusEl.textContent = '导出已开始！';
          setTimeout(() => window.close(), 1000); // 1秒后自动关闭弹出窗口
        } else if (response && response.status === 'already_running') {
          statusEl.textContent = '导出已在运行中...';
          setTimeout(() => window.close(), 1000);
        } else {
          statusEl.textContent = '未知响应。';
          exportButton.textContent = '开始导出';
          exportButton.disabled = false;
        }
      })
      .catch((e: any) => {
        statusEl.textContent = '错误：脚本未注入。请刷新S1页面后重试。';
        console.error(e.message);
        exportButton.textContent = '开始导出';
        exportButton.disabled = false; // 允许重试
      });
  });
});