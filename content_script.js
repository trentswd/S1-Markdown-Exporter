// S1-Exporter-Plugin/content_script.js (V3.3 - 移除 JsRender, 修复 CSP)
(function() {
    'use strict';

    // --- 0. 检查依赖 (V3.3 修复版) ---
    // 移除了 JsRender (jQuery.templates) 的检查
    if (typeof jQuery === 'undefined') {
        console.error('S1 Exporter: 依赖 (jQuery) 未能正确加载！脚本停止。');
        return;
    }
    if (typeof TurndownService === 'undefined') {
        console.error('S1 Exporter: 依赖 (TurndownService) 未能正确加载！脚本停止。');
        return;
    }

    // --- 1. 全局状态锁 ---
    window.s1ExportRunning = false;

    // --- 2. Configuration (不变) ---
    const APP_API_URL = 'https://app.stage1st.com/2b/api/app';
    const SID_STORAGE_KEY = 's1_app_sid';
    const BLOCKED_TEXT_SELECTORS = ['.plhin:contains("作者被禁止或删除 内容自动屏蔽")', '#messagetext:contains("内容审核中，即将开放")'];
    
    // --- 3. Dependencies Setup ---
    const $ = jQuery.noConflict(true);
    
    // ** 插入了 V3.2.1 修复 **
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
    });

    // --- 4. 状态指示器 (不变) ---
    let statusDiv = null;
    function showStatus(message, isError = false) {
        if (!statusDiv) {
            statusDiv = document.createElement('div');
            statusDiv.id = 's1-exporter-status';
            statusDiv.style.position = 'fixed';
            statusDiv.style.top = '20px';
            statusDiv.style.right = '20px';
            statusDiv.style.padding = '15px 20px';
            statusDiv.style.background = '#333';
            statusDiv.style.color = 'white';
            statusDiv.style.zIndex = '99999';
            statusDiv.style.borderRadius = '5px';
            statusDiv.style.fontSize = '16px';
            statusDiv.style.fontFamily = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
            document.body.appendChild(statusDiv);
        }
        statusDiv.textContent = message;
        statusDiv.style.background = isError ? '#d9534f' : '#007aff';
    }
    function hideStatus() {
        if (statusDiv) {
            statusDiv.remove();
            statusDiv = null;
        }
    }

    // --- 5. 下载器类 (不变) ---
    class ImageDownloader {
        constructor() {
            this.queue = new Map();
            this.filenamesInZip = new Set();
            this.pathPrefix = this.getFormattedDatePaths();
            this.failedDownloads = [];
        }
        getFormattedDatePaths() {
            const now = new Date();
            const YYYY = now.getFullYear();
            const MM = (now.getMonth() + 1).toString().padStart(2, '0');
            const DD = now.getDate().toString().padStart(2, '0');
            const HH = now.getHours().toString().padStart(2, '0');
            return `${YYYY}/${YYYY}-${MM}/${DD}-${HH}/`;
        }
        getUniqueFilename(originalFilename) {
            let baseName, extension;
            const dotIndex = originalFilename.lastIndexOf('.');
            if (dotIndex === -1 || dotIndex === 0) {
                baseName = originalFilename;
                extension = '.png';
            } else {
                baseName = originalFilename.substring(0, dotIndex);
                extension = originalFilename.substring(dotIndex);
            }
            baseName = baseName.replace(/[:*?"<>|]/g, '_');
            let finalFilename = baseName + extension;
            let counter = 1;
            while (this.filenamesInZip.has(this.pathPrefix + finalFilename)) {
                finalFilename = `${baseName}-${counter}${extension}`;
                counter++;
            }
            const fullPath = this.pathPrefix + finalFilename;
            this.filenamesInZip.add(fullPath);
            return fullPath;
        }
        enqueue(imageUrl, altText = 'image') {
            if (!imageUrl || !imageUrl.startsWith('http')) {
                return `![${altText}](${imageUrl})`;
            }
            if (this.queue.has(imageUrl)) {
                return `![[${this.queue.get(imageUrl)}]]`;
            }
            let originalFilename;
            try {
                let path = new URL(imageUrl).pathname.split('/').pop();
                originalFilename = decodeURIComponent(path.split('?')[0]);
                if (!originalFilename || originalFilename.trim() === '') originalFilename = altText;
            } catch (e) {
                originalFilename = altText;
            }
            const newSavePath = this.getUniqueFilename(originalFilename);
            this.queue.set(imageUrl, newSavePath);
            return `![[${newSavePath}]]`;
        }
        async processQueue(updateCallback) {
            const total = this.queue.size;
            if (total === 0) {
                updateCallback(0, 0, "没有需要下载的图片。");
                return;
            }
            addLog(`S1 Exporter: 开始下载 ${total} 张图片...`);
            let i = 0;
            this.failedDownloads = [];
            for (const [url, savePath] of this.queue.entries()) {
                i++;
                updateCallback(i, total, savePath);
                try {
                    const response = await chrome.runtime.sendMessage({
                        type: 'downloadImage',
                        url: url,
                        savePath: savePath
                    });
                    if (!response.success) throw new Error(response.error || '下载任务创建失败');
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (e) {
                    addLog(`❌ 图片下载失败: ${url} (保存至: ${savePath}) - 错误: ${e.message}`, 'red');
                    this.failedDownloads.push({ url, savePath, error: e.message });
                }
            }
            addLog(`S1 Exporter: 图片队列处理完毕。${this.failedDownloads.length} 个失败。`, 'blue');
        }
    }
    
    // --- 6. Turndown Rules (不变) ---
    let downloader = new ImageDownloader();
    turndownService.addRule('s1AttachmentImage', {
        filter: (node) => (node.nodeName === 'IMG' && (node.hasAttribute('aid') || (node.getAttribute('src')?.endsWith('/none.gif') && (node.hasAttribute('zoomfile') || node.hasAttribute('file'))))),
        replacement: (content, node) => {
            let imageUrl = '';
            const zoomfile = node.getAttribute('zoomfile');
            const file = node.getAttribute('file');
            const src = node.getAttribute('src');
            const aid = node.getAttribute('aid') || '未知ID';
            if (zoomfile && zoomfile.startsWith('http')) imageUrl = zoomfile;
            else if (file && file.startsWith('http')) imageUrl = file;
            else if (src && !src.endsWith('/none.gif') && src.startsWith('http')) imageUrl = src;
            else if (file && file.startsWith('data/attachment')) imageUrl = `${location.origin}/2b/${file}`;
            else if (src && src.startsWith('data/attachment')) imageUrl = `${location.origin}/2b/${src}`;
            let altText = node.getAttribute('alt') || `附件 ${aid}`;
            if (altText.toLowerCase() === 'attachimg' || altText.trim() === '') altText = `附件 ${aid}`;
            if (!imageUrl) return `[附件图片 aid=${aid} 加载失败]`;
            return downloader.enqueue(imageUrl, altText);
        }
    });
    turndownService.addRule('externalImage', {
        filter: (node) => (node.nodeName === 'IMG' && node.getAttribute('src') && node.getAttribute('src').startsWith('http') && !node.hasAttribute('aid') && !node.getAttribute('src').includes('/smiley/')),
        replacement: (content, node) => downloader.enqueue(node.getAttribute('src'), node.getAttribute('alt') || 'ext_image')
    });
    turndownService.addRule('s1SmileyObsidian', {
        filter: (node) => (node.nodeName === 'IMG' && node.hasAttribute('smilieid') && node.getAttribute('src').includes('/smiley/')),
        replacement: (content, node) => {
            const src = node.getAttribute('src');
            const smilieid = node.getAttribute('smilieid');
            let path = `表情${smilieid || ''}`;
            const match = src.match(/\/smiley\/(.+)$/);
            if (match && match[1]) path = match[1];
            let result = `![[${path}`;
            if (smilieid) result += `|smilieid=${smilieid}`;
            result += ']]';
            return result;
        }
    });
    turndownService.addRule('s1Quote', {
        filter: (node) => (node.nodeName === 'BLOCKQUOTE' && node.querySelector('div.quote > font')),
        replacement: (content, node) => {
            const headerFont = node.querySelector('div.quote > font');
            let authorAndTime = '用户';
            if (headerFont) authorAndTime = headerFont.innerText.replace(/\s+/g, ' ').trim();
            const contentClone = node.cloneNode(true);
            contentClone.querySelector('div.quote')?.remove();
            const quoteText = turndownService.turndown(contentClone);
            return `> **引用 ${authorAndTime}:**\n>\n` + quoteText.split('\n').map(line => `> ${line}`).join('\n') + '\n\n';
        }
    });
    turndownService.addRule('s1SimpleQuote', {
        filter: (node) => (node.nodeName === 'BLOCKQUOTE' && !node.querySelector('div.quote > font')),
        replacement: (content) => {
            const trimmedContent = content.trim();
            if (trimmedContent.startsWith('本帖最后由') && !trimmedContent.includes('\n')) return `> *${trimmedContent}*\n\n`;
            return '\n> ' + trimmedContent.replace(/\n/g, '\n> ') + '\n\n';
        }
    });
    
    // --- 7. [新] CSP-Safe Templates ---
    // 移除了 JsRender ($.templates)，使用纯 JS 模板字符串来规避 'unsafe-eval'
    
    function getDialogHtml(data) {
        // 使用可选链和空值合并操作符来安全地处理 undefined
        const username = data?.username ?? "";
        const password = data?.password ?? "";
        const msg = data?.msg ?? "";
    
        return `
         <div id="login-dialog" style="width: 400px; height: 260px; position: fixed; top: 50%; left: 50%; margin-left: -200px; margin-top: -130px; z-index: 9999; background: #F6F7EB; border: 3px solid #CCCC99; padding-left: 20px; padding-right: 20px;">
             <div style="width: 100%; padding-top: 20px">通过s1官方app接口查看不可见内容，需要单独登录<span style="float: right; cursor: pointer; font-weight: bold;" class="flbc" id="login-close">X</span></div>
             <div style="width: 100%; padding-top: 20px"><input type="text" id="username" value="${username}" placeholder="用户名" style="width: 95%;"></div>
             <div style="width: 100%; padding-top: 20px"><input type="password" id="password" value="${password}" placeholder="密码" style="width: 95%;"></div>
             <div style="width: 100%; padding-top: 20px">
                 <select id="questionId" style="width: 100%;">
                     <option value="0">安全提问(未设置请忽略)</option>
                     <option value="1">母亲的名字</option>
                     <option value="2">爷爷的名字</option>
                     <option value="3">父亲出生的城市</option>
                     <option value="4">您其中一位老师的名字</option>
                     <option value="5">您个人计算机的型号</option>
                     <option value="6">您最喜欢的餐馆名称</option>
                     <option value="7">驾驶执照最后四位数字</option>
                 </select>
             </div>
             <div id="answer-row" hidden>
                 <div style="width: 100%; padding-top: 20px"><input type="text" id="answer" placeholder="答案" style="width: 95%;"></div>
             </div>
             <div style="width: 100%; padding-top: 20px"><button id="login-confirm">确定</button></div>
             <div style="width: 100%; padding-top: 10px; color: red; height: 20px;">${msg}</div>
         </div>`;
    }

    function getPostHtml(postData) {
        const pid = postData?.pid ?? 'unknown';
        // 关键：postData.message 本身就是 HTML，所以我们直接注入
        const message = postData?.message ?? '[内容为空]'; 
        
        return `
         <div class="t_fsz">
             <table cellspacing="0" cellpadding="0">
                 <tbody>
                     <tr>
                         <td class="t_f" id="postmessage_${pid}">
                             ${message}
                         </td>
                     </tr>
                 </tbody>
             </table>
         </div>`;
    }
    
    // --- 8. Global Variables (不变) ---
    let appSid = null;
    let globalTid = null;
    let loginPromiseResolver = null;

    // --- 9. UI Setup (已删除) ---
    // (入口点已改为消息监听)

    // --- 10. Core Export Logic (不变) ---
    async function mainExport() {
        window.s1ExportRunning = true; 
        showStatus('准备中...');
        downloader = new ImageDownloader();
        try {
            const data = await chrome.storage.local.get(SID_STORAGE_KEY);
            appSid = data[SID_STORAGE_KEY] || null;
            if (!appSid) {
                console.log("S1 Exporter: 未找到 App SID, 需要登录.");
                showStatus('需要登录...');
                const loginSuccess = await loginAndShowDialog();
                if (!loginSuccess) throw new Error("登录取消或失败");
                const data = await chrome.storage.local.get(SID_STORAGE_KEY);
                appSid = data[SID_STORAGE_KEY];
                console.log("S1 Exporter: 登录成功.");
            } else {
                console.log("S1 Exporter: 使用已存储的 App SID.");
            }
            const titleEl = document.getElementById('thread_subject');
            const urlEl = document.querySelector('link[rel="canonical"]');
            const sectionLinks = document.querySelectorAll('#pt .z a[href^="forum-"]');
            const sectionEl = sectionLinks.length > 0 ? sectionLinks[sectionLinks.length - 1] : null;
            const title = titleEl ? titleEl.innerText.trim() : '未知标题';
            const url = urlEl ? urlEl.href : location.href;
            const section = sectionEl ? sectionEl.innerText.trim() : '未知版块';
            globalTid = await getThreadIdFromPage();
            if (!globalTid) throw new Error("无法获取帖子 TID");
            showStatus('加载页面...');
            await loadAllPagesAndUnblock();
            showStatus('正在解析...');
            const markdown = parseAllPosts(title, url, section);
            await downloader.processQueue((current, total, filename) => {
                 showStatus(`下载图片 ${current}/${total}...`);
            });
            downloadMarkdown(title, markdown);
            if(downloader.failedDownloads.length > 0) {
                showStatus(`导出完成，${downloader.failedDownloads.length}张图片失败！`, true);
                alert(`导出完成，但有 ${downloader.failedDownloads.length} 张图片下载失败，请检查控制台（F12）获取详情。`);
                console.warn("S1 Exporter: 以下图片下载失败:", downloader.failedDownloads);
                setTimeout(hideStatus, 5000); 
            } else {
                showStatus('导出成功！');
                setTimeout(hideStatus, 3000); 
            }
        } catch (e) {
            console.error('S1 Markdown 导出失败:', e);
            showStatus(`导出失败: ${e.message}`, true);
            if (e.message && (e.message.includes("登录失效") || e.message.includes("LOGIN_INVALID"))) {
                await chrome.storage.local.remove(SID_STORAGE_KEY);
                showStatus('导出失败 (需重新登录)', true);
            }
            setTimeout(hideStatus, 5000); 
        } finally {
             window.s1ExportRunning = false;
        }
    }

    // --- 11. Page Loading (不变) ---
    async function loadAllPagesAndUnblock() {
        const currentPageEl = document.querySelector('#pgt .pg strong');
        if (!currentPageEl) return;
        const totalPagesEl = document.querySelector('#pgt .pg span[title^="共"]');
        let totalPages = 1;
        if (totalPagesEl) {
             const totalPagesMatch = totalPagesEl.innerText.match(/\/ (\d+) 页/);
             if (totalPagesMatch) totalPages = parseInt(totalPagesMatch[1], 10);
        }
        const currentPage = parseInt(currentPageEl.innerText, 10);
        const postList = document.getElementById('postlist');
        if (!postList) throw new Error("无法找到 #postlist 元素");
        console.log(`S1 Exporter: 开始处理, 共 ${totalPages} 页, 当前为 ${currentPage} 页.`);
        showStatus(`处理 ${currentPage}/${totalPages}...`);
        const currentPosts = Array.from(postList.querySelectorAll(':scope > div[id^="post_"]'));
        await unblockPosts(currentPosts, currentPage);
        if (currentPage >= totalPages) return;
        for (let i = currentPage + 1; i <= totalPages; i++) {
            showStatus(`加载 ${i}/${totalPages}...`);
            const pageUrl = `${location.protocol}//${location.host}/2b/thread-${globalTid}-${i}-1.html`;
            const htmlText = await fetchPageHtml(pageUrl); 
            const doc = new DOMParser().parseFromString(htmlText, 'text/html');
            const newPostsHtml = doc.querySelectorAll('#postlist > div[id^="post_"]');
            const newlyAddedPosts = [];
            newPostsHtml.forEach(postNode => {
                const importedPost = document.importNode(postNode, true);
                postList.appendChild(importedPost);
                newlyAddedPosts.push(importedPost);
            });
            showStatus(`解锁 ${i}/${totalPages}...`);
            await unblockPosts(newlyAddedPosts, i);
        }
    }
    
    async function fetchPageHtml(url) {
        try {
            const response = await fetch(url, { method: 'GET', credentials: 'omit' });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.text();
        } catch (error) {
            console.error(`S1 Exporter: 加载页面 ${url} 失败`, error);
            throw error;
        }
    }

    // --- 12. Content Unblocking (修改版) ---
    async function unblockPosts(postsToCheck, pageNum) {
        let needsUnblocking = false;
        const blockedPostElements = [];
        const blockedSelectorString = BLOCKED_TEXT_SELECTORS.join(',');
        for (const postEl of postsToCheck) {
            if ($(postEl).find(blockedSelectorString).length > 0) {
                needsUnblocking = true;
                blockedPostElements.push(postEl);
            }
        }
        if (!needsUnblocking) return;
        console.log(`S1 Exporter: Page ${pageNum} 检测到 ${blockedPostElements.length} 个被屏蔽的帖子...`);
        let retry = false;
        try {
            const pageData = await getThreadContentApi(pageNum); 
            const postDataMap = new Map(pageData.list.map(post => [post.pid.toString(), post]));
            for (const postEl of blockedPostElements) {
                const pid = postEl.id.substring(5);
                const postData = postDataMap.get(pid);
                if (postData) {
                    const contentContainer = postEl.querySelector('.pcb');
                    if (contentContainer) {
                        // ** [新] 替换为 CSP-safe 函数 **
                        const renderedHtml = getPostHtml(postData); 
                        $(contentContainer).html(renderedHtml);
                    }
                } else {
                     console.warn(`S1 Exporter: API 数据中未找到 Post ${pid} (Page ${pageNum}).`);
                }
            }
        } catch (error) {
            console.error(`S1 Exporter: 解锁 Page ${pageNum} 时出错:`, error);
            if (error.message === "LOGIN_INVALID" && !retry) {
                console.log("S1 Exporter: SID 失效，尝试重新登录...");
                await chrome.storage.local.remove(SID_STORAGE_KEY);
                const loginSuccess = await loginAndShowDialog();
                if (loginSuccess) {
                    const data = await chrome.storage.local.get(SID_STORAGE_KEY);
                    appSid = data[SID_STORAGE_KEY];
                    console.log("S1 Exporter: 重新登录成功，重试解锁...");
                    retry = true;
                    await unblockPosts(postsToCheck, pageNum);
                } else {
                    throw new Error("重新登录失败，无法解锁内容");
                }
            } else {
                throw error;
            }
        }
    }
    
    async function getThreadContentApi(pageNum, pageSize = 40) {
        const url = new URL(APP_API_URL + '/thread/page');
        const params = { sid: appSid, tid: globalTid, pageNo: pageNum, pageSize: pageSize };
        const response = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
            body: new URLSearchParams(params).toString()
        });
        if (!response.ok) throw new Error(`API /thread/page 请求失败: ${response.statusText}`);
        const resp = await response.json();
        return new Promise((resolve, reject) => handleApiResponse(resp, resolve, reject));
    }
    
    function handleApiResponse(resp, resolve, reject) {
       try {
            const data = typeof resp === 'string' ? JSON.parse(resp) : resp;
            const code = data.code?.toString();
            if (!code) { reject(new Error("API_INVALID_RESPONSE")); return; }
            if (code.startsWith('50')) { console.warn("S1 Exporter: API 返回登录错误:", data.message); reject(new Error("LOGIN_INVALID")); return; }
            if (code !== '200') { console.warn("S1 Exporter: API 返回非成功状态码:", code, data.message); }
            if (data.data) { resolve(data.data); } 
            else { console.warn("S1 Exporter: API 响应成功但缺少 data 字段:", data); reject(new Error("API_MISSING_DATA")); }
        } catch (e) { console.error("S1 Exporter: 解析 API 响应失败:", e, "原始响应:", resp); reject(new Error("API_PARSE_ERROR")); }
    }

    // --- 13. Login Logic (修改版) ---
    function loginAndShowDialog(initialData = {}) {
        return new Promise((resolve) => {
            loginPromiseResolver = resolve;
            $('#login-dialog').remove();
            
            // ** [新] 替换为 CSP-safe 函数 **
            $('body').append(getDialogHtml(initialData)); 
            
            const dialog = $('#login-dialog');
            const rawHeight = dialog.height();
            $('#questionId').change(function () {
                let questionId = $(this).val();
                if (questionId === '0') {
                    dialog.height(rawHeight);
                    $('#answer-row').hide();
                } else {
                    if (!$('#answer-row').is(':visible')) dialog.height(dialog.height() + $('#answer-row').outerHeight(true) + 20);
                    $('#answer-row').show();
                }
            }).trigger('change');
            $('#login-confirm').click(() => loginApiCall($('#username').val(), $('#password').val(), $('#questionId').val(), $('#answer').val()));
            $('#login-close').click(() => {
                dialog.remove();
                if (loginPromiseResolver) { loginPromiseResolver(false); loginPromiseResolver = null; }
            });
        });
    }

    async function loginApiCall(username, password, questionId, answer) {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);
        if (questionId !== '0') { formData.append('questionid', questionId); formData.append('answer', answer); }
        $('#login-dialog div:last-child').text('登录中...');
        try {
            const response = await fetch(APP_API_URL + '/user/login', { method: 'POST', headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'}, body: formData.toString() });
            if (!response.ok) throw new Error(`登录 API 请求失败: ${response.statusText}`);
            const responseData = await response.json();
            const code = responseData.code?.toString();
            if (code && !code.startsWith('50') && responseData.data?.sid) {
                await chrome.storage.local.set({ [SID_STORAGE_KEY]: responseData.data.sid }); 
                $('#login-dialog').remove();
                if (loginPromiseResolver) { loginPromiseResolver(true); loginPromiseResolver = null; }
            } else {
                $('#login-dialog div:last-child').text(responseData.message || '登录失败，请检查信息。');
            }
        } catch (e) {
            console.error("Login API request failed:", e);
            $('#login-dialog div:last-child').text('登录请求失败，请检查网络。');
        }
    }
    
    // --- 14. Parsing and Downloading (不变) ---
    function parseAllPosts(title, url, section) {
        let md = `# ${title}\n\n**版块:** ${section}\n**原帖:** <${url}>\n\n`;
        const posts = document.querySelectorAll('#postlist > div[id^="post_"]');
        console.log(`S1 Exporter: 找到 ${posts.length} 个帖子进行最终解析.`);
        posts.forEach(post => {
            const author = post.querySelector('.pi .authi .xw1')?.innerText.trim() || '未知作者';
            let floor = post.querySelector('.pi strong a[id^="postnum"]')?.innerText.trim() || 'N/A';
            const time = post.querySelector('em[id^="authorposton"]')?.innerText.replace('发表于 ', '').trim() || '未知时间';
            if (floor === '楼主') floor = '1# (楼主)';
            else if (floor && floor.includes('#')) floor = floor.replace(' #', '#');
            const contentEl = post.querySelector('td[id^="postmessage_"]');
            if (!contentEl) {
                md += `---\n\n## ${floor} | ${author} | ${time}\n\n[内容无法加载或已被删除]\n\n`;
                return; 
            }
            const contentClone = contentEl.cloneNode(true);
            contentClone.querySelector('.cronclosethread_getbox')?.remove();
            const pstatus = contentClone.querySelector('i.pstatus');
            if (pstatus) {
                const block = document.createElement('blockquote');
                block.innerText = pstatus.innerText.trim();
                pstatus.parentNode.replaceChild(block, pstatus);
            }
            const links = contentClone.querySelectorAll('a[href]');
            const baseUrl = `${location.origin}/2b/`;
            links.forEach(link => {
                let href = link.getAttribute('href');
                if (href && !href.startsWith('http') && !href.startsWith('//') && !href.startsWith('#') && !href.startsWith('javascript:')) {
                    try { link.setAttribute('href', new URL(href, baseUrl).href); } 
                    catch (e) { console.warn(`无法将相对链接转换为绝对链接: ${href}`, e); }
                }
            });
            let markdownContent = turndownService.turndown(contentClone);
            md += `---\n\n## ${floor} | ${author} | ${time}\n\n${markdownContent.trim()}\n\n`;
        });
        return md;
    }

    function downloadMarkdown(title, text) {
        const filename = title.replace(/[\\/:*?"<>|]/g, '_') + '.md';
        const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log(`S1 Exporter: Markdown 文件 "${filename}" 已触发下载.`);
    }

    // --- 15. Utility Functions (不变) ---
    async function getThreadIdFromPage() {
        let foundTid = null;
        try {
            const response = await chrome.runtime.sendMessage({ type: 'getTid' });
            if (response && response.tid) foundTid = response.tid.toString();
        } catch (e) { console.warn("S1 Exporter: 无法从页面上下文 (window.tid) 获取TID:", e.message); }
        if (foundTid) { console.log("S1 Exporter: 从 window.tid 获得 TID:", foundTid); return foundTid; }
        const pathname = window.location.pathname;
        const searchParams = new URLSearchParams(window.location.search);
        if (pathname.startsWith('/2b/thread-')) {
            const parts = pathname.split('-');
            if (parts.length >= 2) foundTid = parts[1];
        } else if (pathname.startsWith('/2b/forum.php')) {
            foundTid = searchParams.get('tid');
        }
        if (foundTid) console.log("S1 Exporter: 从 URL 获得 TID:", foundTid);
        else console.warn("S1 Exporter: 未能从 URL 或全局变量中解析 TID.");
        return foundTid;
    }
    
    function addLog(message, color = 'black') {
        console.log(message);
    }

    // --- 16. 消息监听器 (不变) ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.type === 'startExport') {
            if (window.s1ExportRunning) {
                console.warn("S1 Exporter: 导出已在进行中！");
                sendResponse({ status: "already_running" });
                return true; 
            }
            mainExport();
            sendResponse({ status: "started" });
        }
        return true; 
    });

    // --- 启动 ---
    console.log("S1 Exporter (v3.3 - CSP 修复版) 已加载。");

})();