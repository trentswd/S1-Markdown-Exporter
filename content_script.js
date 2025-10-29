// S1-Exporter-Plugin/content_script.js
(function() {
    'use strict';

    // --- 0. 检查依赖 ---
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

// --- 5. 下载器类 (修改版：支持 tid 和 s1_page) ---
    class ImageDownloader {
        constructor(tid) {
            this.queue = new Map();
            this.filenamesInZip = new Set();
            this.failedDownloads = [];
            this.linkFormat = 'obsidian';
            this.downloadEnabled = true;
            this.tid = tid || 'unknown_tid'; // [新增]
        }
        setDownloadEnabled(enabled) {
            this.downloadEnabled = !!enabled;
            console.log(`[ImageDownloader] Image downloading ${this.downloadEnabled ? 'ENABLED' : 'DISABLED'}.`);
        }
        setLinkFormat(format) {
            if (format === 'standard' || format === 'obsidian') {
                this.linkFormat = format;
                console.log(`[ImageDownloader] Link format set to: ${this.linkFormat}`);
            } else {
                console.warn(`[ImageDownloader] Invalid link format specified: ${format}. Using default 'obsidian'.`);
                this.linkFormat = 'obsidian';
            }
        }
        
        // [修改] 路径生成逻辑
        getUniqueFilename(originalFilename, s1Page) {
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
            
            // [修改] 使用新的路径前缀
            const pathPrefix = `${this.tid}/${s1Page}/`;
            
            let finalFilename = baseName + extension;
            let counter = 1;
            
            // [修改] 检查完整路径
            while (this.filenamesInZip.has(pathPrefix + finalFilename)) {
                finalFilename = `${baseName}-${counter}${extension}`;
                counter++;
            }
            const fullPath = pathPrefix + finalFilename;
            this.filenamesInZip.add(fullPath);
            return fullPath;
        }

        // [修改] 增加 'node' 参数
        enqueue(imageUrl, altText = 'image', node) {
            if (!imageUrl || !imageUrl.startsWith('http')) {
                return `![${altText}](${imageUrl})`;
            }
            if (!this.downloadEnabled) {
                const escapedAlt = altText.replace(/\]/g, '\\]');
                return `![${escapedAlt}](${imageUrl})`;
            }
            
            // [新增] 从 node 获取 s1_page
            const s1Page = node?.dataset.s1Page || 'unknown_page';
            
            if (this.queue.has(imageUrl)) {
                const savePath = this.queue.get(imageUrl);
                if (this.linkFormat === 'standard') {
                    return `![${altText}](${encodeURI(savePath)})`;
                } else {
                    return `![[${savePath}]]`;
                }
            }
            let originalFilename;
            try {
                let path = new URL(imageUrl).pathname.split('/').pop();
                originalFilename = decodeURIComponent(path.split('?')[0]);
                if (!originalFilename || originalFilename.trim() === '') originalFilename = altText;
            } catch (e) {
                originalFilename = altText;
            }
            
            // [修改] 传递 s1Page
            const newSavePath = this.getUniqueFilename(originalFilename, s1Page);
            
            this.queue.set(imageUrl, newSavePath);
            addLog(`S1 Exporter: 入队图片， ${imageUrl}, ${altText}, ${newSavePath}`)
            if (this.linkFormat === 'standard') {
                return `![${altText}](${encodeURI(newSavePath)})`;
            } else {
                return `![[${newSavePath}]]`;
            }
        }
        
        async processQueue(updateCallback) {
            // ... (这个函数不变) ...
            const total = this.queue.size;
            if (total === 0) {
                updateCallback(0, 0, "没有需要下载的图片。");
                return;
            }
            addLog(`S1 Exporter: 开始下载 ${total} 张图片 (保存至 '下载' 文件夹下的子目录)...`, 'blue'); // 提示用户位置
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

                    if (!response || !response.success) {
                        throw new Error(response?.error || '下载任务创建失败 (无详细信息)');
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 50));

                } catch (e) {
                    addLog(`❌ 图片下载失败: ${url} (目标路径: ${savePath}) - 错误: ${e.message}`, 'red');
                    this.failedDownloads.push({ url, savePath, error: e.message });
                }
            }
            addLog(`S1 Exporter: 图片队列处理完毕。${this.failedDownloads.length} 个失败。`, 'blue');
        }
    }
    
    
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

// --- 10. Core Export Logic (重大修改版 V2) ---
    async function mainExport(options) {
        window.s1ExportRunning = true; 
        showStatus('准备中...');
        
        // --- 1. 获取 TID 和初始化 Downloader (功能3) ---
        globalTid = await getThreadIdFromPage();
        if (!globalTid) {
             window.s1ExportRunning = false;
             throw new Error("无法获取帖子 TID");
        }
        
        let downloader = new ImageDownloader(globalTid); // [修复] 声明 downloader
        downloader.setLinkFormat(options.linkFormat);
        downloader.setDownloadEnabled(options.downloadImages);

        // --- 2. 动态初始化 Turndown (功能1) ---
        const turndownService = new TurndownService({
            headingStyle: 'atx',
            codeBlockStyle: 'fenced',
            bulletListMarker: '-',
        });

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
                if (!imageUrl) {
                     console.warn("[Turndown Rule: s1AttachmentImage] 未能找到附件图片的有效 URL:", node.outerHTML);
                     return `[附件图片 aid=${aid} 加载失败]`;
                }
                console.log(`[Turndown Rule: s1AttachmentImage] Enqueueing: ${imageUrl}`);
                return downloader.enqueue(imageUrl, altText, node); 
            }
        });
        turndownService.addRule('externalImage', {
            filter: (node) => (node.nodeName === 'IMG' && node.getAttribute('src') && node.getAttribute('src').startsWith('http') && !node.hasAttribute('aid') && !node.getAttribute('src').includes('/smiley/')),
            replacement: (content, node) => {
                const src = node.getAttribute('src');
                const alt = node.getAttribute('alt') || 'ext_image';
                console.log(`[Turndown Rule: externalImage] Enqueueing: ${src}`);
                return downloader.enqueue(src, alt, node);
            }
        });
        turndownService.addRule('s1SmileyObsidian', { 
            filter: (node) => (node.nodeName === 'IMG' && node.hasAttribute('smilieid') && node.getAttribute('src').includes('/smiley/')),
            replacement: (content, node) => {
                const src = node.getAttribute('src');
                const smilieid = node.getAttribute('smilieid');
                if (options.emoteFormat === 'standard') {
                    return `![${smilieid || 'smiley'}](${src})`;
                }
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

        try {
            // ... (登录逻辑) ...
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
            
            // ... (获取 title, url, section) ...
            const titleEl = document.getElementById('thread_subject');
            const urlEl = document.querySelector('link[rel="canonical"]');
            const sectionLinks = document.querySelectorAll('#pt .z a[href^="forum-"]');
            const sectionEl = sectionLinks.length > 0 ? sectionLinks[sectionLinks.length - 1] : null;
            const title = titleEl ? titleEl.innerText.trim() : '未知标题';
            const url = urlEl ? urlEl.href : location.href;
            const section = sectionEl ? sectionEl.innerText.trim() : '未知版块';


            // --- 3. [修改 V3] 计算有效的楼层范围 (Bug 修复) ---
            const { postsPerFile, startFile, endFile } = options;

            // 步骤 1: 确定 "基础范围"
            let baseStartFloor = options.startFloor || 1;
            let baseEndFloor = options.endFloor || null; // 确保是 null

            // 步骤 2: 确定 "分页范围" (相对于基础范围)
            let effectiveStartFloor = baseStartFloor;
            let effectiveEndFloor = baseEndFloor;

            if (postsPerFile) {
                // 如果设置了MD分页，它将 *约束* 基础范围
                const mdStartPage = startFile || 1;
                const mdEndPage = endFile || null; // 确保是 null

                // 步骤 2a: 计算分页的 "起始" 楼层
                // 这是相对于 baseStartFloor 的
                // 例子: 基础 51, 第 2 页, 每页 100 -> 51 + (2-1)*100 = 151 楼
                effectiveStartFloor = baseStartFloor + (mdStartPage - 1) * postsPerFile;

                // 步骤 2b: 计算分页的 "结束" 楼层
                let pagingEndFloor = null;
                if (mdEndPage) {
                    // 如果指定了结束页
                    const totalPagesToTake = mdEndPage - mdStartPage + 1;
                    if (totalPagesToTake > 0) {
                        const totalPostsToTake = totalPagesToTake * postsPerFile;
                        // 例子: 起始 51, 拿 1 页 (1-1), 100个 -> 51 + 100 - 1 = 150 楼
                        pagingEndFloor = effectiveStartFloor + totalPostsToTake - 1;
                    }
                }
                // 如果 mdEndPage 未指定 (null)，则 pagingEndFloor 保持 null (意为 "到基础范围的末尾")

                // 步骤 2c: 将 "基础结束楼层" 和 "分页结束楼层" 合并
                // 我们必须取两者中 *较小* (更严格) 的那个
                if (baseEndFloor !== null && pagingEndFloor !== null) {
                    effectiveEndFloor = Math.min(baseEndFloor, pagingEndFloor);
                } else {
                    effectiveEndFloor = baseEndFloor || pagingEndFloor; // 使用任何一个非null的值
                }
            }
            
            // 步骤 3: 最终安全检查
            // "起始楼层" 也不能超过 "基础结束楼层" (如果设置了)
            if (baseEndFloor !== null && effectiveStartFloor > baseEndFloor) {
                // 这种情况是无效的，例如请求 1-100 楼，但从第 2 页(101楼)开始
                console.warn(`[MainExport] 计算出的起始楼层 (${effectiveStartFloor}) 大于结束楼层 (${baseEndFloor}). 导出将为空.`);
                // 将范围设为无效，这样就不会加载任何内容
                effectiveStartFloor = baseEndFloor + 1; 
            }
            
            console.log(`[MainExport] 选项:`, options);
            console.log(`[MainExport] 计算出的有效范围: Floors ${effectiveStartFloor || '1'} to ${effectiveEndFloor || 'End'}`);
            // --- 3. 计算结束 ---


            showStatus('加载页面...');
            
            // --- 4. [修改] 传递有效范围给加载器 ---
            const { allPostElements, actualStartPage, actualEndPage } = await loadAllPagesAndUnblock(
                options.postsPerPage, // S1的每页帖子数
                effectiveStartFloor,  // 我们刚计算出的有效起始楼层
                effectiveEndFloor     // 我们刚计算出的有效结束楼层
            );
            
            const pageRangeInfo = actualStartPage !== null ? `(S1页: ${actualStartPage}-${actualEndPage})` : "";
            showStatus(`正在解析 ${pageRangeInfo}...`);
            
            // --- 5. [修改] 传递有效范围给解析器 ---
            // (parseAllPosts 内部的楼层过滤现在是第二重保险，确保只解析我们想要的)
            const { header, posts } = parseAllPosts(
                title, 
                url, 
                section, 
                allPostElements, 
                effectiveStartFloor, // 传递有效范围
                effectiveEndFloor,  // 传递有效范围
                turndownService
            );
            
            // --- 6. [Bug 修复] 下载队列现在是正确的 ---
            // 因为 `posts` 数组只包含有效范围内的帖子，
            // `downloader` 队列也只包含这些帖子里的图片。
            await downloader.processQueue((current, total, filename) => {
                 showStatus(`下载图片 ${current}/${total}...`);
            });

            // --- 7. [修改] Markdown 分页逻辑 (Bug 修复) ---
            
            if (postsPerFile === null || postsPerFile <= 0) {
                // [原逻辑] 导出单个文件
                showStatus('正在生成 Markdown...');
                const fullMd = header + posts.map(p => {
                    return `\n\n---\n\n## ${p.floor} | ${p.author} | ${p.time}\n\n${p.mdContent.trim()}${p.rateContent}`;
                }).join('');
                downloadMarkdown(title, fullMd);
                
            } else {
                // [新逻辑] 分页导出
                const chunks = chunkArray(posts, postsPerFile);
                // `posts` 数组现在只包含我们获取的范围 (例如 101-200楼)
                // `chunks` 可能是 `[ [101-200楼的帖子] ]`
                
                // 我们需要文件的 "基础页码"
                const baseFileNumber = options.startFile || 1; 

                showStatus(`正在生成 ${chunks.length} 个文件...`);
                
                for (let i = 0; i < chunks.length; i++) {
                    const filePageIndex = baseFileNumber + i;
                    const chunk = chunks[i];
                    
                    const mdString = header + chunk.map(p => {
                         return `\n\n---\n\n## ${p.floor} | ${p.author} | ${p.time}\n\n${p.mdContent.trim()}${p.rateContent}`;
                    }).join('');
                    
                    downloadMarkdown(`${title} - Page ${filePageIndex}`, mdString);
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
            // --- 7. 分页逻辑结束 ---

            // ... (结束状态显示) ...
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
            // ... (错误处理) ...
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

// --- 11. Page Loading (修改版 V2：使用有效范围) ---
    async function loadAllPagesAndUnblock(postsPerPage, startFloor, endFloor) { // [修改] 签名
        const allCollectedPosts = [];
        let actualStartPage = null;
        let actualEndPage = null;

        const currentPageEl = document.querySelector('#pgt .pg strong');
        const totalPagesEl = document.querySelector('#pgt .pg span[title^="共"]');
        
        let totalPages = 1;
        let currentPage = 1;

        if (totalPagesEl) {
             const totalPagesMatch = totalPagesEl.innerText.match(/\/ (\d+) 页/);
             if (totalPagesMatch) totalPages = parseInt(totalPagesMatch[1], 10);
        }
        
        if (currentPageEl) {
            currentPage = parseInt(currentPageEl.innerText, 10);
        }
        
        const postList = document.getElementById('postlist');
        if (!postList) throw new Error("无法找到 #postlist 元素");
        
        // [修改] 使用传入的参数
        console.log(`S1 Exporter: 总 ${totalPages} 页, 当前 ${currentPage} 页. 请求楼层 ${startFloor ?? '1'}-${endFloor ?? 'End'}, 每页 ${postsPerPage}.`);

        // --- ** 计算目标页面范围 ** ---
        let targetStartPage = 1;
        let targetEndPage = totalPages;

        // [修改] 根据我们传入的有效楼层范围来计算 S1 页面
        if (startFloor !== null || endFloor !== null) {
            if (startFloor !== null) {
                targetStartPage = Math.max(1, Math.floor((startFloor - 1) / postsPerPage) + 1);
            }
            if (endFloor !== null) {
                targetEndPage = Math.min(totalPages, Math.floor((endFloor - 1) / postsPerPage) + 1);
            }
            
            console.log(`[Optimize] Calculated target page range: ${targetStartPage} - ${targetEndPage}`);
        } else {
            console.log(`[Optimize] No floor range specified, loading all pages: 1 - ${totalPages}`);
        }
        
        actualStartPage = targetStartPage;
        actualEndPage = targetEndPage;
        
        // ... (函数其余部分不变) ...
        // [为节约空间，省略了 for 循环，请保留你原来的代码]
        for (let i = targetStartPage; i <= targetEndPage; i++) {
            actualEndPage = i; 
            if (i === currentPage) {
                 // --- 处理当前（第一）页 ---
                 showStatus(`处理 ${i}/${totalPages}...`);
                 console.log(`处理当前页 (${i})`);
                 const originalCurrentPosts = Array.from(postList.querySelectorAll(':scope > div[id^="post_"]'));
                 
                 originalCurrentPosts.forEach(post => post.dataset.s1Page = i);
                 
                 await unblockPosts(originalCurrentPosts, i); 
                 
                 originalCurrentPosts.forEach(post => {
                    post.querySelectorAll('img').forEach(img => img.dataset.s1Page = i);
                 });
                 
                 console.log(`重新解析当前页 (${i})...`);
                 const firstPageHtml = postList.innerHTML;
                 const firstPageDoc = new DOMParser().parseFromString(`<body><div id="postlist">${firstPageHtml}</div></body>`, 'text/html');
                 const reparsedCurrentPosts = Array.from(firstPageDoc.querySelectorAll('#postlist > div[id^="post_"]'));
                 
                 reparsedCurrentPosts.forEach(post => {
                    post.dataset.s1Page = i;
                    post.querySelectorAll('img').forEach(img => img.dataset.s1Page = i);
                 });
                 
                 allCollectedPosts.push(...reparsedCurrentPosts);
                 console.log(`当前页 (${i}) 处理完成，添加 ${reparsedCurrentPosts.length} 帖子。`);

             } else {
                 // --- 处理非当前页（需要 fetch） ---
                 showStatus(`加载 ${i}/${totalPages}...`);
                 console.log(`加载目标页 (${i})`);
                 const pageUrl = `${location.protocol}//${location.host}/2b/thread-${globalTid}-${i}-1.html`;
                 let htmlText;
                 try { htmlText = await fetchPageHtml(pageUrl); }
                 catch (fetchError) { console.error(`Page ${i}: 获取 HTML 失败!`, fetchError); continue; }

                 const doc = new DOMParser().parseFromString(htmlText, 'text/html');
                 const postsToParse = doc.querySelectorAll('#postlist > div[id^="post_"]');

                 const newlyAddedPosts = [];
                 postsToParse.forEach(postNode => {
                    postNode.dataset.s1Page = i;
                    newlyAddedPosts.push(postNode);
                 });

                 if (newlyAddedPosts.length === 0) {
                      const onlyIdPosts = doc.querySelectorAll('div[id^="post_"]');
                      if(onlyIdPosts.length > 0) console.warn(`[V3.9] Page ${i}: 找到了帖子，但不在 #postlist 下！`);
                      else console.warn(`[V3.9] Page ${i}: 未找到任何帖子元素！跳过。`);
                      continue;
                 }

                 showStatus(`解锁 ${i}/${totalPages}...`);
                 await unblockPosts(newlyAddedPosts, i); 
                 
                 newlyAddedPosts.forEach(postNode => {
                    postNode.querySelectorAll('img').forEach(img => img.dataset.s1Page = i);
                 });
                 
                 allCollectedPosts.push(...newlyAddedPosts);
                 console.log(`目标页 (${i}) 处理完成，添加 ${newlyAddedPosts.length} 帖子。`);
             }
        }

        console.log(`S1 Exporter: 所有页面加载和解锁完成，共收集到 ${allCollectedPosts.length} 个帖子元素。`);
        return { allPostElements: allCollectedPosts, actualStartPage, actualEndPage };
    }
    
    async function fetchPageHtml(url) {
        try {
            const response = await fetch(url, { method: 'GET', credentials: 'same-origin' });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.text();
        } catch (error) {
            console.error(`S1 Exporter: 加载页面 ${url} 失败`, error);
            throw error;
        }
    }

    // --- 12. Content Unblocking (修改版) ---
    async function unblockPosts(postsToCheck, pageNum) {
        console.log(`S1 Exporter: 尝试解锁, 当前为 ${pageNum} 页.`);
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

    function parseFloorNumber(floorStr) {
        if (!floorStr) return null;
        // 显式处理楼主
        if (floorStr.includes('楼主')) return 1;
        // 尝试从 "数字#" 或纯数字中提取
        const match = floorStr.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : null;
    }
    // --- 14. Parsing and Downloading (修改版：返回数组) ---
    function parseAllPosts(title, url, section, allPostElements, startFloor, endFloor, turndownService) {
        // [修改] 只生成 Header
        let header = `# ${title}\n\n**版块:** ${section}\n**原帖:** <${url}>\n\n`;
        const posts = allPostElements;
        let includedPostCount = 0;
        
        const parsedPosts = []; // [修改] 结果数组

        addLog(`[parseAllPosts] 函数开始执行，选择器找到了 ${posts.length} 个帖子。`);
        if (posts.length === 0) {
            console.error("[parseAllPosts] 错误：选择器没有找到任何帖子！");
            addLog("[parseAllPosts] 错误：选择器没有找到任何帖子！", 'red');
            return { header: "[错误：未能解析任何帖子内容]", posts: [] }; // [修改]
        }
        
        console.log(`S1 Exporter: 找到 ${posts.length} 个帖子进行最终解析.`);
        posts.forEach((post, index) => {
            const floorElement = post.querySelector('.pi strong a[id^="postnum"]');
            const floorStr = floorElement ? floorElement.innerText.trim() : 'N/A';
            const floorNum = parseFloorNumber(floorStr);

            console.log(`[Debug] Post Index ${index}, Element ID ${post.id}, Floor Str: "${floorStr}", Parsed Floor Num: ${floorNum}`);

            // --- 楼层过滤逻辑 ---
            let skip = false;
            if (floorNum !== null) {
                if (startFloor !== null && floorNum < startFloor) {
                    console.log(`[Filter] Skipping floor ${floorNum} (< start ${startFloor})`);
                    skip = true;
                }
                if (endFloor !== null && floorNum > endFloor) {
                    console.log(`[Filter] Skipping floor ${floorNum} (> end ${endFloor})`);
                    skip = true;
                }
            } else {
                 if (startFloor !== null || endFloor !== null) {
                      console.warn(`[Filter] Skipping post ${post.id} because floor "${floorStr}" could not be parsed and a range was specified.`);
                      skip = true;
                 } else {
                      console.log(`[Filter] Including post ${post.id} with unparsed floor "${floorStr}" because no range specified.`);
                 }
            }
            if (skip) return;
            // --- 过滤结束 ---

            includedPostCount++;

            const author = post.querySelector('.pi .authi .xw1')?.innerText.trim() || '未知作者';
            let floor = post.querySelector('.pi strong a[id^="postnum"]')?.innerText.trim() || 'N/A';
            const time = post.querySelector('em[id^="authorposton"]')?.innerText.replace('发表于 ', '').trim() || '未知时间';
            if (floor === '楼主') floor = '1# (楼主)';
            else if (floor && floor.includes('#')) floor = floor.replace(' #', '#');
            const contentEl = post.querySelector('td[id^="postmessage_"]');
            
            let markdownContent = '[内容无法加载或已被删除]';
            
            if (contentEl) {
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
                console.log(`[parseAllPosts] Running Turndown for post ${post.id}...`);
                markdownContent = turndownService.turndown(contentClone); // [修改] 使用传入的 service
            }

            // --- ** 解析评分部分 ** ---
            let rateContent = '\n\n'; // [修改]
            const rateLogElement = post.querySelector(`dl[id^="ratelog_"]`);
            if (rateLogElement) {
                const rateTable = rateLogElement.querySelector('table.ratl');
                if (rateTable) {
                    const rows = rateTable.querySelectorAll('tbody.ratl_l tr');
                    const header = rateTable.querySelector('tbody tr');
                    let summary = '';
                    if (header) {
                         const participants = header.querySelector('th:nth-child(1) span')?.innerText || '?';
                         const points = header.querySelector('th:nth-child(2) i span')?.innerText || '?';
                         summary = ` (参与人数 \`${participants}\`, 总战斗力 \`${points}\`)`;
                    }

                    if (rows.length > 0) {
                        rateContent += `> **评分**${summary}:\n`; // [修改]
                        rows.forEach(row => {
                            const userLink = row.querySelector('td:nth-child(1) a:last-of-type');
                            const user = userLink ? userLink.innerText.trim() : '匿名';
                            const score = row.querySelector('td:nth-child(2)')?.innerText.trim() || '?';
                            const reason = row.querySelector('td:nth-child(3)')?.innerText.trim() || '';
                            let escapedUser = user;
                            if (/^\d+\./.test(user)) {
                                escapedUser = user.replace('.', '\\.'); 
                            }
                            rateContent += `> - ${escapedUser} \`${score}\` ${reason}\n`; // [修改]
                        });
                        rateContent += `>\n\n`; // [修改]
                    }
                }
            }
            // --- ** 评分解析结束 ** ---
            
            // [修改] 添加到数组
            parsedPosts.push({
                floor: floor,
                author: author,
                time: time,
                mdContent: markdownContent,
                rateContent: rateContent
            });
        });
        
        // [修改] 返回对象
        return { header: header, posts: parsedPosts };
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

    // --- [新增] 数组分块辅助函数 (功能2) ---
    function chunkArray(array, chunkSize) {
        if (chunkSize <= 0) return [array];
        const chunks = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    // --- 16. 消息监听器 (修改版：增加 getTidAndSettings) ---
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        
        if (message.type === 'startExport') {
            if (window.s1ExportRunning) {
                console.warn("S1 Exporter: 导出已在进行中！");
                sendResponse({ status: "already_running" });
                return true; 
            }
            const options = message.options || {
                startFloor: null,
                endFloor: null,
                postsPerPage: 40,
                downloadImages: true,
                linkFormat: 'obsidian',
                emoteFormat: 'obsidian',
                postsPerFile: null,
                startFile: null,
                endFile: null
            };
            
            mainExport(options); 
            sendResponse({ status: "started" });
            return true; 
        }

        // [新增] 响应来自 popup.js 的请求，获取TID和对应的设置
        if (message.type === 'getTidAndSettings') {
            (async () => {
                try {
                    const tid = await getThreadIdFromPage();
                    let settings = null;
                    if (tid) {
                        const storageKey = `s1_exporter_settings_${tid}`;
                        const settingsJson = localStorage.getItem(storageKey);
                        if (settingsJson) {
                            settings = JSON.parse(settingsJson);
                            console.log(`[ContentScript] Found settings for ${tid}:`, settings);
                        }
                    }
                    // 无论是否有设置，都返回TID
                    sendResponse({ tid: tid, settings: settings });
                } catch (e) {
                    console.error("[ContentScript] Error getting TID or settings:", e);
                    sendResponse({ tid: null, settings: null, error: e.message });
                }
            })();
            return true; // 保持异步消息通道开放
        }

        // [新增] 响应来自 popup.js 的保存请求
        if (message.type === 'saveSettings') {
            const { tid, options } = message;
            if (tid) {
                try {
                    const storageKey = `s1_exporter_settings_${tid}`;
                    localStorage.setItem(storageKey, JSON.stringify(options));
                    console.log(`[ContentScript] Settings for ${tid} saved.`);
                    sendResponse({ status: "saved" });
                } catch (e) {
                    console.error("[ContentScript] Failed to save settings:", e);
                    sendResponse({ status: "error", error: e.message });
                }
            } else {
                console.warn("[ContentScript] Save request received without TID.");
                sendResponse({ status: "error", error: "No TID provided" });
            }
            return true; // 保持异步
        }
        
        return true; 
    });

    // --- 启动 ---
    console.log("S1 Exporter 已加载。");

})();