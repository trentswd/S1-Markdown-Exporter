// entrypoints/content.ts

// [FIXED] 导入 browser API 和 Browser 命名空间
import { browser, type Browser } from 'wxt/browser';
import TurndownService from 'turndown';

export default defineContentScript({
  matches: [
    "https://*.stage1st.com/2b/thread-*",
    "https://*.stage1st.com/2b/forum.php*tid=*",
    "https://*.bbs.saraba1st.com/2b/thread-*",
    "https://*.bbs.saraba1st.com/2b/forum.php*tid=*"
  ],
  runAt: 'document_idle',

  main() {
    
    // --- 1. 全局状态锁 ---
    (window as any).s1ExportRunning = false;

    // --- 2. Configuration ---
    const APP_API_URL = 'https://app.stage1st.com/2b/api/app';
    const SID_STORAGE_KEY = 's1_app_sid';

    // --- 3. Dependencies Setup ---
    const turndownService = new TurndownService({
        headingStyle: 'atx',
        codeBlockStyle: 'fenced',
        bulletListMarker: '-',
    });

    // --- 4. 状态指示器 ---
    let statusDiv: HTMLDivElement | null = null;
    function showStatus(message: string, isError = false) {
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

    // --- 5. 下载器类 ---
    class ImageDownloader {
        queue: Map<string, string>;
        filenamesInZip: Set<string>;
        failedDownloads: { url: string; savePath: string; error: string }[];
        linkFormat: 'obsidian' | 'standard';
        downloadEnabled: boolean;
        tid: string;

        constructor(tid: string) {
            this.queue = new Map();
            this.filenamesInZip = new Set();
            this.failedDownloads = [];
            this.linkFormat = 'obsidian';
            this.downloadEnabled = true;
            this.tid = tid || 'unknown_tid';
        }

        setDownloadEnabled(enabled: boolean) {
            this.downloadEnabled = !!enabled;
            console.log(`[ImageDownloader] Image downloading ${this.downloadEnabled ? 'ENABLED' : 'DISABLED'}.`);
        }

        setLinkFormat(format: string) {
            if (format === 'standard' || format === 'obsidian') {
                this.linkFormat = format as 'obsidian' | 'standard';
                console.log(`[ImageDownloader] Link format set to: ${this.linkFormat}`);
            } else {
                console.warn(`[ImageDownloader] Invalid link format specified: ${format}. Using default 'obsidian'.`);
                this.linkFormat = 'obsidian';
            }
        }
        
        getUniqueFilename(originalFilename: string, s1Page: string): string {
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
            
            const pathPrefix = `${this.tid}/${s1Page}/`;
            
            let finalFilename = baseName + extension;
            let counter = 1;
            
            while (this.filenamesInZip.has(pathPrefix + finalFilename)) {
                finalFilename = `${baseName}-${counter}${extension}`;
                counter++;
            }
            const fullPath = pathPrefix + finalFilename;
            this.filenamesInZip.add(fullPath);
            return fullPath;
        }

        enqueue(imageUrl: string, altText = 'image', node: HTMLElement): string {
            if (!imageUrl || !imageUrl.startsWith('http')) {
                return `![${altText}](${imageUrl})`;
            }
            if (!this.downloadEnabled) {
                const escapedAlt = altText.replace(/\]/g, '\\]');
                return `![${escapedAlt}](${imageUrl})`;
            }
            
            const s1Page = node?.dataset.s1Page || 'unknown_page';
            
            if (this.queue.has(imageUrl)) {
                const savePath = this.queue.get(imageUrl)!;
                if (this.linkFormat === 'standard') {
                    return `![${altText}](${encodeURI(savePath)})`;
                } else {
                    return `![[${savePath}]]`;
                }
            }
            
            let originalFilename: string;
            try {
                let path = new URL(imageUrl).pathname.split('/').pop()!;
                originalFilename = decodeURIComponent(path.split('?')[0]);
                if (!originalFilename || originalFilename.trim() === '') originalFilename = altText;
            } catch (e) {
                originalFilename = altText;
            }
            
            const newSavePath = this.getUniqueFilename(originalFilename, s1Page);
            
            this.queue.set(imageUrl, newSavePath);
            addLog(`S1 Exporter: 入队图片， ${imageUrl}, ${altText}, ${newSavePath}`)
            if (this.linkFormat === 'standard') {
                return `![${altText}](${encodeURI(newSavePath)})`;
            } else {
                return `![[${newSavePath}]]`;
            }
        }
        
        async processQueue(updateCallback: (current: number, total: number, filename: string) => void) {
            const total = this.queue.size;
            if (total === 0) {
                updateCallback(0, 0, "没有需要下载的图片。");
                return;
            }
            addLog(`S1 Exporter: 开始下载 ${total} 张图片 (保存至 '下载' 文件夹下的子目录)...`, 'blue');
            let i = 0;
            this.failedDownloads = [];

            for (const [url, savePath] of this.queue.entries()) {
                i++;
                updateCallback(i, total, savePath);
                try {
                    const response = await browser.runtime.sendMessage({
                        type: 'downloadImage',
                        url: url,
                        savePath: savePath
                    });

                    if (!response || !response.success) {
                        throw new Error(response?.error || '下载任务创建失败 (无详细信息)');
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 50));

                } catch (e: any) {
                    addLog(`❌ 图片下载失败: ${url} (目标路径: ${savePath}) - 错误: ${e.message}`, 'red');
                    this.failedDownloads.push({ url, savePath, error: e.message });
                }
            }
            addLog(`S1 Exporter: 图片队列处理完毕。${this.failedDownloads.length} 个失败。`, 'blue');
        }
    }


    // --- 7. CSP-Safe Templates ---
    function getDialogHtml(data: any): string {
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
             <div id="answer-row" style="display: none;">
                 <div style="width: 100%; padding-top: 20px"><input type="text" id="answer" placeholder="答案" style="width: 95%;"></div>
             </div>
             <div style="width: 100%; padding-top: 20px"><button id="login-confirm">确定</button></div>
             <div style="width: 100%; padding-top: 10px; color: red; height: 20px;">${msg}</div>
         </div>`;
    }

    function getPostHtml(postData: any): string {
        const pid = postData?.pid ?? 'unknown';
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

    // --- 8. Global Variables ---
    let appSid: string | null = null;
    let globalTid: string | null = null;
    let loginPromiseResolver: ((value: boolean) => void) | null = null;

    // --- 10. Core Export Logic ---
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

    async function mainExport(options: ExportOptions) {
        (window as any).s1ExportRunning = true; 
        showStatus('准备中...');
        
        try {
            // --- 1. 获取 TID 和初始化 Downloader ---
            globalTid = await getThreadIdFromPage();
            if (!globalTid) {
                 (window as any).s1ExportRunning = false;
                 throw new Error("无法获取帖子 TID");
            }
            
            let downloader = new ImageDownloader(globalTid);
            downloader.setLinkFormat(options.linkFormat);
            downloader.setDownloadEnabled(options.downloadImages);

            // --- 2. 动态初始化 Turndown ---
            turndownService.addRule('s1AttachmentImage', {
                // [FIXED] 强制返回 boolean
                filter: (node) => !!(node.nodeName === 'IMG' && (node.hasAttribute('aid') || (node.getAttribute('src')?.endsWith('/none.gif') && (node.hasAttribute('zoomfile') || node.hasAttribute('file'))))),
                replacement: (content: string, node: Node) => {
                    let imageUrl = '';
                    const el = node as HTMLElement;
                    const zoomfile = el.getAttribute('zoomfile');
                    const file = el.getAttribute('file');
                    const src = el.getAttribute('src');
                    const aid = el.getAttribute('aid') || '未知ID';
                    if (zoomfile && zoomfile.startsWith('http')) imageUrl = zoomfile;
                    else if (file && file.startsWith('http')) imageUrl = file;
                    else if (src && !src.endsWith('/none.gif') && src.startsWith('http')) imageUrl = src;
                    else if (file && file.startsWith('data/attachment')) imageUrl = `${location.origin}/2b/${file}`;
                    else if (src && src.startsWith('data/attachment')) imageUrl = `${location.origin}/2b/${src}`;
                    let altText = el.getAttribute('alt') || `附件 ${aid}`;
                    if (altText.toLowerCase() === 'attachimg' || altText.trim() === '') altText = `附件 ${aid}`;
                    if (!imageUrl) {
                         console.warn("[Turndown Rule: s1AttachmentImage] 未能找到附件图片的有效 URL:", el.outerHTML);
                         return `[附件图片 aid=${aid} 加载失败]`;
                    }
                    console.log(`[Turndown Rule: s1AttachmentImage] Enqueueing: ${imageUrl}`);
                    return downloader.enqueue(imageUrl, altText, el); 
                }
            });
            turndownService.addRule('externalImage', {
                // [FIXED] 强制返回 boolean
                filter: (node) => !!(node.nodeName === 'IMG' && node.getAttribute('src') && node.getAttribute('src')!.startsWith('http') && !node.hasAttribute('aid') && !node.getAttribute('src')!.includes('/smiley/')),
                replacement: (content: string, node: Node) => {
                    const el = node as HTMLElement;
                    const src = el.getAttribute('src')!;
                    const alt = el.getAttribute('alt') || 'ext_image';
                    console.log(`[Turndown Rule: externalImage] Enqueueing: ${src}`);
                    return downloader.enqueue(src, alt, el);
                }
            });
            turndownService.addRule('s1SmileyObsidian', { 
                // [FIXED] 强制返回 boolean
                filter: (node) => !!(node.nodeName === 'IMG' && node.hasAttribute('smilieid') && node.getAttribute('src')!.includes('/smiley/')),
                replacement: (content: string, node: Node) => {
                    const el = node as HTMLElement;
                    const src = el.getAttribute('src')!;
                    const smilieid = el.getAttribute('smilieid');
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
                // [FIXED] 强制返回 boolean
                filter: (node) => !!(node.nodeName === 'BLOCKQUOTE' && node.querySelector('div.quote > font')),
                replacement: (content: string, node: Node) => {
                    const headerFont = (node as HTMLElement).querySelector('div.quote > font') as HTMLElement;
                    let authorAndTime = '用户';
                    if (headerFont) authorAndTime = headerFont.innerText.replace(/\s+/g, ' ').trim();
                    const contentClone = node.cloneNode(true) as HTMLElement;
                    contentClone.querySelector('div.quote')?.remove();
                    const quoteText = turndownService.turndown(contentClone); 
                    return `> **引用 ${authorAndTime}:**\n>\n` + quoteText.split('\n').map((line: string) => `> ${line}`).join('\n') + '\n\n';
                }
            });
            turndownService.addRule('s1SimpleQuote', {
                // [FIXED] 强制返回 boolean
                filter: (node) => !!(node.nodeName === 'BLOCKQUOTE' && !node.querySelector('div.quote > font')),
                replacement: (content: string) => {
                    const trimmedContent = content.trim();
                    if (trimmedContent.startsWith('本帖最后由') && !trimmedContent.includes('\n')) return `> *${trimmedContent}*\n\n`;
                    return '\n> ' + trimmedContent.replace(/\n/g, '\n> ') + '\n\n';
                }
            });

            // --- 登录逻辑 ---
            const data = await browser.storage.local.get(SID_STORAGE_KEY);
            appSid = data[SID_STORAGE_KEY] || null;
            if (!appSid) {
                console.log("S1 Exporter: 未找到 App SID, 需要登录.");
                showStatus('需要登录...');
                const loginSuccess = await loginAndShowDialog();
                if (!loginSuccess) throw new Error("登录取消或失败");
                const data = await browser.storage.local.get(SID_STORAGE_KEY);
                appSid = data[SID_STORAGE_KEY];
                console.log("S1 Exporter: 登录成功.");
            } else {
                console.log("S1 Exporter: 使用已存储的 App SID.");
            }
            
            // --- 获取帖子信息 ---
            const titleEl = document.getElementById('thread_subject');
            const urlEl = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
            const sectionLinks = document.querySelectorAll('#pt .z a[href^="forum-"]');
            const sectionEl = sectionLinks.length > 0 ? sectionLinks[sectionLinks.length - 1] as HTMLElement : null;
            const title = titleEl ? (titleEl as HTMLElement).innerText.trim() : '未知标题';
            const url = urlEl ? urlEl.href : location.href;
            const section = sectionEl ? sectionEl.innerText.trim() : '未知版块';

            // --- 楼层范围计算 ---
            const { postsPerFile, startFile, endFile } = options;
            let baseStartFloor = options.startFloor || 1;
            let baseEndFloor = options.endFloor || null;
            let effectiveStartFloor = baseStartFloor;
            let effectiveEndFloor = baseEndFloor;
            if (postsPerFile) {
                const mdStartPage = startFile || 1;
                const mdEndPage = endFile || null;
                effectiveStartFloor = baseStartFloor + (mdStartPage - 1) * postsPerFile;
                let pagingEndFloor: number | null = null;
                if (mdEndPage) {
                    const totalPagesToTake = mdEndPage - mdStartPage + 1;
                    if (totalPagesToTake > 0) {
                        const totalPostsToTake = totalPagesToTake * postsPerFile;
                        pagingEndFloor = effectiveStartFloor + totalPostsToTake - 1;
                    }
                }
                if (baseEndFloor !== null && pagingEndFloor !== null) {
                    effectiveEndFloor = Math.min(baseEndFloor, pagingEndFloor);
                } else {
                    effectiveEndFloor = baseEndFloor || pagingEndFloor;
                }
            }
            if (baseEndFloor !== null && effectiveStartFloor > baseEndFloor) {
                console.warn(`[MainExport] 计算出的起始楼层 (${effectiveStartFloor}) 大于结束楼层 (${baseEndFloor}). 导出将为空.`);
                effectiveStartFloor = baseEndFloor + 1; 
            }
            console.log(`[MainExport] 选项:`, options);
            console.log(`[MainExport] 计算出的有效范围: Floors ${effectiveStartFloor || '1'} to ${effectiveEndFloor || 'End'}`);


            showStatus('加载页面...');
            
            // --- 4. 加载页面 ---
            const { allPostElements, actualStartPage, actualEndPage } = await loadAllPagesAndUnblock(
                options.postsPerPage,
                effectiveStartFloor,
                effectiveEndFloor
            );
            
            const pageRangeInfo = actualStartPage !== null ? `(S1页: ${actualStartPage}-${actualEndPage})` : "";
            showStatus(`正在解析 ${pageRangeInfo}...`);
            
            // --- 5. 解析 ---
            const { header, posts } = parseAllPosts(
                title, 
                url, 
                section, 
                allPostElements, 
                effectiveStartFloor,
                effectiveEndFloor,
                turndownService
            );
            
            // --- 6. 下载 ---
            await downloader.processQueue((current, total, filename) => {
                 showStatus(`下载图片 ${current}/${total}...`);
            });

            // --- 7. 分页与保存 ---
            if (postsPerFile === null || postsPerFile <= 0) {
                showStatus('正在生成 Markdown...');
                const fullMd = header + posts.map(p => {
                    return `\n\n---\n\n## ${p.floor} | ${p.author} | ${p.time}\n\n${p.mdContent.trim()}${p.rateContent}`;
                }).join('');
                downloadMarkdown(title, fullMd);
                
            } else {
                const chunks = chunkArray(posts, postsPerFile);
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

            // --- 结束状态显示 ---
            if(downloader.failedDownloads.length > 0) {
                showStatus(`导出完成，${downloader.failedDownloads.length}张图片失败！`, true);
                alert(`导出完成，但有 ${downloader.failedDownloads.length} 张图片下载失败，请检查控制台（F12）获取详情。`);
                console.warn("S1 Exporter: 以下图片下载失败:", downloader.failedDownloads);
                setTimeout(hideStatus, 5000); 
            } else {
                showStatus('导出成功！');
                setTimeout(hideStatus, 3000); 
            }
        } catch (e: any) {
            // --- 错误处理 ---
            console.error('S1 Markdown 导出失败:', e);
            showStatus(`导出失败: ${e.message}`, true);
            if (e.message && (e.message.includes("登录失效") || e.message.includes("LOGIN_INVALID"))) {
                await browser.storage.local.remove(SID_STORAGE_KEY);
                showStatus('导出失败 (需重新登录)', true);
            }
            setTimeout(hideStatus, 5000); 
        } finally {
             (window as any).s1ExportRunning = false;
        }
    }

    // --- 11. Page Loading ---
    async function loadAllPagesAndUnblock(postsPerPage: number, startFloor: number | null, endFloor: number | null) {
        const allCollectedPosts: Element[] = [];
        let actualStartPage: number | null = null;
        let actualEndPage: number | null = null;

        const currentPageEl = document.querySelector('#pgt .pg strong') as HTMLElement;
        const totalPagesEl = document.querySelector('#pgt .pg span[title^="共"]') as HTMLElement;
        
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
        
        console.log(`S1 Exporter: 总 ${totalPages} 页, 当前 ${currentPage} 页. 请求楼层 ${startFloor ?? '1'}-${endFloor ?? 'End'}, 每页 ${postsPerPage}.`);

        let targetStartPage = 1;
        let targetEndPage = totalPages;

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
        
        for (let i = targetStartPage; i <= targetEndPage; i++) {
            actualEndPage = i; 
            if (i === currentPage) {
                 showStatus(`处理 ${i}/${totalPages}...`);
                 console.log(`处理当前页 (${i})`);
                 const originalCurrentPosts = Array.from(postList.querySelectorAll(':scope > div[id^="post_"]'));
                 
                 originalCurrentPosts.forEach(post => (post as HTMLElement).dataset.s1Page = String(i));
                 
                 await unblockPosts(originalCurrentPosts, i); 
                 
                 originalCurrentPosts.forEach(post => {
                    post.querySelectorAll('img').forEach(img => (img as HTMLElement).dataset.s1Page = String(i));
                 });
                 
                 console.log(`重新解析当前页 (${i})...`);
                 const firstPageHtml = postList.innerHTML;
                 const firstPageDoc = new DOMParser().parseFromString(`<body><div id="postlist">${firstPageHtml}</div></body>`, 'text/html');
                 const reparsedCurrentPosts = Array.from(firstPageDoc.querySelectorAll('#postlist > div[id^="post_"]'));
                 
                 reparsedCurrentPosts.forEach(post => {
                    (post as HTMLElement).dataset.s1Page = String(i);
                    post.querySelectorAll('img').forEach(img => (img as HTMLElement).dataset.s1Page = String(i));
                 });
                 
                 allCollectedPosts.push(...reparsedCurrentPosts);
                 console.log(`当前页 (${i}) 处理完成，添加 ${reparsedCurrentPosts.length} 帖子。`);

             } else {
                 showStatus(`加载 ${i}/${totalPages}...`);
                 console.log(`加载目标页 (${i})`);
                 const pageUrl = `${location.protocol}//${location.host}/2b/thread-${globalTid}-${i}-1.html`;
                 let htmlText: string;
                 try { htmlText = await fetchPageHtml(pageUrl); }
                 catch (fetchError) { console.error(`Page ${i}: 获取 HTML 失败!`, fetchError); continue; }

                 const doc = new DOMParser().parseFromString(htmlText, 'text/html');
                 const postsToParse = doc.querySelectorAll('#postlist > div[id^="post_"]');

                 const newlyAddedPosts: Element[] = [];
                 postsToParse.forEach(postNode => {
                    (postNode as HTMLElement).dataset.s1Page = String(i);
                    newlyAddedPosts.push(postNode);
                 });

                 if (newlyAddedPosts.length === 0) {
                      const onlyIdPosts = doc.querySelectorAll('div[id^="post_"]');
                      if(onlyIdPosts.length > 0) console.warn(`[Page ${i}] 找到了帖子，但不在 #postlist 下！`);
                      else console.warn(`[Page ${i}] 未找到任何帖子元素！跳过。`);
                      continue;
                 }

                 showStatus(`解锁 ${i}/${totalPages}...`);
                 await unblockPosts(newlyAddedPosts, i); 
                 
                 newlyAddedPosts.forEach(postNode => {
                    postNode.querySelectorAll('img').forEach(img => (img as HTMLElement).dataset.s1Page = String(i));
                 });
                 
                 allCollectedPosts.push(...newlyAddedPosts);
                 console.log(`目标页 (${i}) 处理完成，添加 ${newlyAddedPosts.length} 帖子。`);
             }
        }

        console.log(`S1 Exporter: 所有页面加载和解锁完成，共收集到 ${allCollectedPosts.length} 个帖子元素。`);
        return { allPostElements: allCollectedPosts, actualStartPage, actualEndPage };
    }

    async function fetchPageHtml(url: string): Promise<string> {
        try {
            const response = await fetch(url, { method: 'GET', credentials: 'same-origin' });
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            return await response.text();
        } catch (error) {
            console.error(`S1 Exporter: 加载页面 ${url} 失败`, error);
            throw error;
        }
    }

    // --- 12. Content Unblocking ---
    async function unblockPosts(postsToCheck: Element[], pageNum: number) {
        console.log(`S1 Exporter: 尝试解锁, 当前为 ${pageNum} 页.`);
        const blockedPostElements: Element[] = [];
        
        const blockedSelectors = [
            '.plhin',
            '#messagetext'
        ];
        const blockedTexts = [
            '作者被禁止或删除 内容自动屏蔽',
            '内容审核中，即将开放'
        ];

        for (const postEl of postsToCheck) {
            let isBlocked = false;
            for (let i = 0; i < blockedSelectors.length; i++) {
                const el = postEl.querySelector(blockedSelectors[i]) as HTMLElement;
                if (el && el.innerText.includes(blockedTexts[i])) {
                    isBlocked = true;
                    break;
                }
            }

            if (isBlocked) {
                blockedPostElements.push(postEl);
            }
        }

        if (blockedPostElements.length === 0) return;

        console.log(`S1 Exporter: Page ${pageNum} 检测到 ${blockedPostElements.length} 个被屏蔽的帖子...`);
        let retry = false;
        try {
            const pageData = await getThreadContentApi(pageNum); 
            const postDataMap = new Map(pageData.list.map((post: any) => [post.pid.toString(), post]));
            
            for (const postEl of blockedPostElements) {
                const pid = postEl.id.substring(5);
                const postData = postDataMap.get(pid);
                if (postData) {
                    const contentContainer = postEl.querySelector('.pcb');
                    if (contentContainer) {
                        contentContainer.innerHTML = getPostHtml(postData);
                    }
                } else {
                     console.warn(`S1 Exporter: API 数据中未找到 Post ${pid} (Page ${pageNum}).`);
                }
            }
        } catch (error: any) {
            console.error(`S1 Exporter: 解锁 Page ${pageNum} 时出错:`, error);
            if (error.message === "LOGIN_INVALID" && !retry) {
                console.log("S1 Exporter: SID 失效，尝试重新登录...");
                await browser.storage.local.remove(SID_STORAGE_KEY);
                const loginSuccess = await loginAndShowDialog();
                if (loginSuccess) {
                    const data = await browser.storage.local.get(SID_STORAGE_KEY);
                    appSid = data[SID_STORAGE_KEY];
                    console.log("S1 Exporter: 重新登录成功，重试解锁...");
                    retry = true;
                    await unblockPosts(postsToCheck, pageNum); // 递归重试
                } else {
                    throw new Error("重新登录失败，无法解锁内容");
                }
            } else {
                throw error;
            }
        }
    }

    async function getThreadContentApi(pageNum: number, pageSize = 40): Promise<any> {
        const url = new URL(APP_API_URL + '/thread/page');
        const params = { sid: appSid!, tid: globalTid!, pageNo: String(pageNum), pageSize: String(pageSize) };
        const response = await fetch(url, {
            method: 'POST',
            headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'},
            body: new URLSearchParams(params).toString()
        });
        if (!response.ok) throw new Error(`API /thread/page 请求失败: ${response.statusText}`);
        const resp = await response.json();
        return new Promise((resolve, reject) => handleApiResponse(resp, resolve, reject));
    }

    function handleApiResponse(resp: any, resolve: (data: any) => void, reject: (reason: Error) => void) {
       try {
            const data = typeof resp === 'string' ? JSON.parse(resp) : resp;
            const code = data.code?.toString();
            if (!code) { reject(new Error("API_INVALID_RESPONSE")); return; }
            if (code.startsWith('50')) { console.warn("S1 Exporter: API 返回登录错误:", data.message); reject(new Error("LOGIN_INVALID")); return; }
            if (code !== '200') { console.warn("S1 Exporter: API 返回非成功状态码:", code, data.message); }
            if (data.data) { resolve(data.data); } 
            else { console.warn("S1 Exporter: API 响应成功但缺少 data 字段:", data); reject(new Error("API_MISSING_DATA")); }
        } catch (e: any) { console.error("S1 Exporter: 解析 API 响应失败:", e, "原始响应:", resp); reject(new Error("API_PARSE_ERROR")); }
    }

    // --- 13. Login Logic ---
    function loginAndShowDialog(initialData: any = {}): Promise<boolean> {
        return new Promise((resolve) => {
            loginPromiseResolver = resolve;
            
            document.getElementById('login-dialog')?.remove();
            document.body.insertAdjacentHTML('beforeend', getDialogHtml(initialData)); 
            
            const dialog = document.getElementById('login-dialog') as HTMLDivElement;
            if (!dialog) {
                console.error("无法创建登录对话框");
                return resolve(false);
            }

            const questionSelect = document.getElementById('questionId') as HTMLSelectElement;
            const answerRow = document.getElementById('answer-row') as HTMLDivElement;
            const confirmButton = document.getElementById('login-confirm') as HTMLButtonElement;
            const closeButton = document.getElementById('login-close') as HTMLSpanElement;
            const usernameInput = document.getElementById('username') as HTMLInputElement;
            const passwordInput = document.getElementById('password') as HTMLInputElement;
            const answerInput = document.getElementById('answer') as HTMLInputElement;
            
            const rawHeight = dialog.offsetHeight; 

            questionSelect?.addEventListener('change', (e) => {
                const questionId = (e.target as HTMLSelectElement).value;
                if (questionId === '0') {
                    dialog.style.height = `${rawHeight}px`;
                    answerRow.style.display = 'none';
                } else {
                    const isAnswerRowVisible = answerRow.style.display !== 'none';
                    if (!isAnswerRowVisible) {
                        answerRow.style.display = 'block'; 
                        const newHeight = dialog.offsetHeight + answerRow.offsetHeight + 20;
                        dialog.style.height = `${newHeight}px`;
                    }
                }
            });

            questionSelect?.dispatchEvent(new Event('change'));

            confirmButton?.addEventListener('click', () => {
                loginApiCall(
                    usernameInput.value, 
                    passwordInput.value, 
                    questionSelect.value, 
                    answerInput.value
                );
            });

            closeButton?.addEventListener('click', () => {
                dialog.remove();
                if (loginPromiseResolver) { loginPromiseResolver(false); loginPromiseResolver = null; }
            });
        });
    }

    async function loginApiCall(username: string, password: string, questionId: string, answer: string) {
        const formData = new URLSearchParams();
        formData.append('username', username);
        formData.append('password', password);
        if (questionId !== '0') { formData.append('questionid', questionId); formData.append('answer', answer); }
        
        const statusLine = document.querySelector('#login-dialog div:last-child') as HTMLDivElement;
        if (statusLine) statusLine.textContent = '登录中...';

        try {
            const response = await fetch(APP_API_URL + '/user/login', { 
                method: 'POST', 
                headers: {'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'}, 
                body: formData.toString() 
            });
            if (!response.ok) throw new Error(`登录 API 请求失败: ${response.statusText}`);
            
            const responseData = await response.json();
            const code = responseData.code?.toString();

            if (code && !code.startsWith('50') && responseData.data?.sid) {
                await browser.storage.local.set({ [SID_STORAGE_KEY]: responseData.data.sid }); 
                
                document.getElementById('login-dialog')?.remove();
                
                if (loginPromiseResolver) { loginPromiseResolver(true); loginPromiseResolver = null; }
            } else {
                if (statusLine) statusLine.textContent = responseData.message || '登录失败，请检查信息。';
            }
        } catch (e: any) {
            console.error("Login API request failed:", e);
            if (statusLine) statusLine.textContent = '登录请求失败，请检查网络。';
        }
    }

    function parseFloorNumber(floorStr: string): number | null {
        if (!floorStr) return null;
        if (floorStr.includes('楼主')) return 1;
        const match = floorStr.match(/^(\d+)/);
        return match ? parseInt(match[1], 10) : null;
    }

    // --- 14. Parsing and Downloading ---
    interface ParsedPost {
        floor: string;
        author: string;
        time: string;
        mdContent: string;
        rateContent: string;
    }

    function parseAllPosts(
        title: string, 
        url: string, 
        section: string, 
        allPostElements: Element[], 
        startFloor: number | null, 
        endFloor: number | null, 
        turndownService: TurndownService
    ): { header: string, posts: ParsedPost[] } {
        
        let header = `# ${title}\n\n**版块:** ${section}\n**原帖:** <${url}>\n\n`;
        const posts = allPostElements;
        
        const parsedPosts: ParsedPost[] = [];

        addLog(`[parseAllPosts] 函数开始执行，选择器找到了 ${posts.length} 个帖子。`);
        if (posts.length === 0) {
            console.error("[parseAllPosts] 错误：选择器没有找到任何帖子！");
            addLog("[parseAllPosts] 错误：选择器没有找到任何帖子！", 'red');
            return { header: "[错误：未能解析任何帖子内容]", posts: [] };
        }
        
        console.log(`S1 Exporter: 找到 ${posts.length} 个帖子进行最终解析.`);
        posts.forEach((post, index) => {
            const floorElement = post.querySelector('.pi strong a[id^="postnum"]') as HTMLElement;
            const floorStr = floorElement ? floorElement.innerText.trim() : 'N/A';
            const floorNum = parseFloorNumber(floorStr);

            console.log(`[Debug] Post Index ${index}, Element ID ${post.id}, Floor Str: "${floorStr}", Parsed Floor Num: ${floorNum}`);

            // --- 楼层过滤逻辑 ---
            let skip = false;
            if (floorNum !== null) {
                if (startFloor !== null && floorNum < startFloor) {
                    skip = true;
                }
                if (endFloor !== null && floorNum > endFloor) {
                    skip = true;
                }
            } else {
                 if (startFloor !== null || endFloor !== null) {
                      console.warn(`[Filter] Skipping post ${post.id} because floor "${floorStr}" could not be parsed and a range was specified.`);
                      skip = true;
                 }
            }
            if (skip) return;
            // --- 过滤结束 ---

            const author = (post.querySelector('.pi .authi .xw1') as HTMLElement)?.innerText.trim() || '未知作者';
            let floor = (post.querySelector('.pi strong a[id^="postnum"]') as HTMLElement)?.innerText.trim() || 'N/A';
            const time = (post.querySelector('em[id^="authorposton"]') as HTMLElement)?.innerText.replace('发表于 ', '').trim() || '未知时间';
            
            if (floor === '楼主') floor = '1# (楼主)';
            else if (floor && floor.includes('#')) floor = floor.replace(' #', '#');
            const contentEl = post.querySelector('td[id^="postmessage_"]');
            
            let markdownContent = '[内容无法加载或已被删除]';
            
            if (contentEl) {
                const contentClone = contentEl.cloneNode(true) as HTMLElement;
                contentClone.querySelector('.cronclosethread_getbox')?.remove();
                const pstatus = contentClone.querySelector('i.pstatus');
                if (pstatus) {
                    const block = document.createElement('blockquote');
                    block.innerText = (pstatus as HTMLElement).innerText.trim();
                    pstatus.parentNode!.replaceChild(block, pstatus);
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
                markdownContent = turndownService.turndown(contentClone);
            }

            // --- 解析评分部分 ---
            let rateContent = '\n\n';
            const rateLogElement = post.querySelector(`dl[id^="ratelog_"]`);
            if (rateLogElement) {
                const rateTable = rateLogElement.querySelector('table.ratl');
                if (rateTable) {
                    const rows = rateTable.querySelectorAll('tbody.ratl_l tr');
                    const header = rateTable.querySelector('tbody tr');
                    let summary = '';
                    if (header) {
                         const participants = (header.querySelector('th:nth-child(1) span') as HTMLElement)?.innerText || '?';
                         const points = (header.querySelector('th:nth-child(2) i span') as HTMLElement)?.innerText || '?';
                         summary = ` (参与人数 \`${participants}\`, 总战斗力 \`${points}\`)`;
                    }

                    if (rows.length > 0) {
                        rateContent += `> **评分**${summary}:\n`;
                        rows.forEach(row => {
                            const userLink = row.querySelector('td:nth-child(1) a:last-of-type') as HTMLElement;
                            const user = userLink ? userLink.innerText.trim() : '匿名';
                            const score = (row.querySelector('td:nth-child(2)') as HTMLElement)?.innerText.trim() || '?';
                            const reason = (row.querySelector('td:nth-child(3)') as HTMLElement)?.innerText.trim() || '';
                            let escapedUser = user;
                            if (/^\d+\./.test(user)) {
                                escapedUser = user.replace('.', '\\.'); 
                            }
                            rateContent += `> - ${escapedUser} \`${score}\` ${reason}\n`;
                        });
                        rateContent += `>\n\n`;
                    }
                }
            }
            
            parsedPosts.push({
                floor: floor,
                author: author,
                time: time,
                mdContent: markdownContent,
                rateContent: rateContent
            });
        });
        
        return { header: header, posts: parsedPosts };
    }

    function downloadMarkdown(title: string, text: string) {
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

    // --- 15. Utility Functions ---
    async function getThreadIdFromPage(): Promise<string | null> {
        let foundTid: string | null = null;
        try {
            const response = await browser.runtime.sendMessage({ type: 'getTid' });
            if (response && response.tid) foundTid = response.tid.toString();
        } catch (e: any) { console.warn("S1 Exporter: 无法从页面上下文 (window.tid) 获取TID:", e.message); }
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

    function addLog(message: string, color = 'black') {
        console.log(message);
    }

    function chunkArray<T>(array: T[], chunkSize: number): T[][] {
        if (chunkSize <= 0) return [array];
        const chunks: T[][] = [];
        for (let i = 0; i < array.length; i += chunkSize) {
            chunks.push(array.slice(i, i + chunkSize));
        }
        return chunks;
    }

    // --- 16. 消息监听器 ---
    browser.runtime.onMessage.addListener((message: any, sender: Browser.runtime.MessageSender, sendResponse: (response?: any) => void) => {
        
        if (message.type === 'startExport') {
            if ((window as any).s1ExportRunning) {
                console.warn("S1 Exporter: 导出已在进行中！");
                sendResponse({ status: "already_running" });
                return true; 
            }
            const options: ExportOptions = message.options || {
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

        if (message.type === 'getTidAndSettings') {
            (async () => {
                try {
                    const tid = await getThreadIdFromPage();
                    let settings: ExportOptions | null = null;
                    if (tid) {
                        const storageKey = `s1_exporter_settings_${tid}`;
                        const settingsJson = localStorage.getItem(storageKey);
                        if (settingsJson) {
                            settings = JSON.parse(settingsJson);
                            console.log(`[ContentScript] Found settings for ${tid}:`, settings);
                        }
                    }
                    sendResponse({ tid: tid, settings: settings });
                } catch (e: any) {
                    console.error("[ContentScript] Error getting TID or settings:", e);
                    sendResponse({ tid: null, settings: null, error: e.message });
                }
            })();
            return true;
        }

        if (message.type === 'saveSettings') {
            const { tid, options } = message;
            if (tid) {
                try {
                    const storageKey = `s1_exporter_settings_${tid}`;
                    localStorage.setItem(storageKey, JSON.stringify(options));
                    console.log(`[ContentScript] Settings for ${tid} saved.`);
                    sendResponse({ status: "saved" });
                } catch (e: any) {
                    console.error("[ContentScript] Failed to save settings:", e);
                    sendResponse({ status: "error", error: e.message });
                }
            } else {
                console.warn("[ContentScript] Save request received without TID.");
                sendResponse({ status: "error", error: "No TID provided" });
            }
            return true;
        }
        
        return true; 
    });

    // --- 启动 ---
    console.log("S1 Exporter (WXT, Modern, TS) 已加载。");
  
  }, // main() 结束
});