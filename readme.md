# S1 Markdown Exporter

[English](#s1-markdown-exporter-en)

这是一个现代化的 Chrome/Firefox 浏览器插件（使用 WXT 框架构建），用于将 Stage1st (S1) 论坛的帖子导出为结构化的 Markdown 文件。

它不仅能抓取当前页面的内容，还能自动加载所有分页，解锁被屏蔽的内容，下载所有图片，并将它们转换为适合本地笔记软件（如 Obsidian）的格式。

## 主要功能

* **完整帖子导出:** 自动抓取所有分页，将整个帖子合并为一个 Markdown 文件。
* **解锁限制内容:** 自动加载被屏蔽的内容（如“作者被禁止或删除”、“内容审核中”）。
* **图片本地下载:** 自动下载帖子中的所有图片（包括附件和外链图）到本地。
* **本地化链接:** 自动将图片链接转换为本地格式，支持 Obsidian (`![[...]]`) 和标准 Markdown (`![](...)`) 两种格式。
* **保留排版:** 妥善处理S1的引用、表情符号和用户评分。
* **灵活选项:** 允许在弹出窗口中自定义导出的楼层范围、是否下载图片等。
* **设置记忆:** 自动保存并加载你对特定帖子的导出设置。

## 安装方法 (开发者模式)

本插件未上架商店，你需要通过开发者模式手动安装：

1.  **下载插件:** 在本 GitHub 仓库页面，点击绿色的 `<> Code` 按钮，然后选择 `Download ZIP`。
2.  **解压文件:** 将下载的 `.zip` 文件 (例如 `S1-Exporter-Plugin-main.zip`) 解压到你电脑上一个**固定**的文件夹（请勿删除此文件夹，否则插件将失效）。
3.  **打开扩展页面:**
    * **Chrome / Edge:** 在地址栏输入 `chrome://extensions` (Edge 用户输入 `edge://extensions`) 并回车。
    * **Firefox:** 在地址栏输入 `about:debugging#/runtime/this-firefox` 并回车。
4.  **开启开发者模式:**
    * **Chrome / Edge:** 在页面右上角，找到 “开发者模式” (Developer mode) 并打开开关。
    * **Firefox:** 点击“加载临时附加组件” (Load Temporary Add-on) 按钮。
5.  **加载插件:**
    * **Chrome / Edge:** 点击页面左上角出现的 “加载已解压的扩展程序” (Load unpacked) 按钮。
    * **Firefox:** （已在步骤4完成）
6.  **选择文件夹 (最重要的一步):**
    在弹出的文件选择框中，**不要**选择你刚刚解压的**根目录**！你需要根据你的浏览器选择对应的 **`.output`** 子目录：

    * **Chrome / Vivaldi / 360 等:**
        `.../S1-Exporter-Plugin-main/.output/chrome-mv3`
    * **Microsoft Edge:**
        `.../S1-Exporter-Plugin-main/.output/edge-mv3`
    * **Firefox:**
        `.../S1-Exporter-Plugin-main/.output/firefox-mv2/manifest.json` (Firefox 可能需要你直接选择 `manifest.json` 文件)

7.  安装完成！你现在应该能在工具栏看到 **台球图标**。

## 如何使用

1.  (安装完成后) 打开任意一个 S1 帖子页面 (例如 `bbs.saraba1st.com/2b/thread-*-1-1.html`)。
2.  点击浏览器工具栏上的插件图标（**台球图标**）。
3.  在弹出的窗口中设置你的选项（例如楼层范围、图片链接格式）。这些设置会**自动保存**并与当前帖子ID关联。
4.  点击 **“开始导出”**。
5.  **[关于登录]** 如果帖子中有被屏蔽的内容，插件会弹出一个登录框。这是为了调用 S1 官方 App API，需要您**单独登录一次** S1 帐号。
6.  等待处理完成（状态栏会显示进度），Markdown 文件和图片将自动下载到你的“下载”文件夹中。

## 隐私政策

我们非常重视您的隐私。

1.  **登录凭据:** 当插件提示您登录时，您输入的用户名和密码**仅被直接发送至 Stage1st 官方App API** (`app.stage1st.com`) 以获取登录令牌 (`sid`)。
2.  **数据存储:** 插件**绝不会**存储您的用户名或密码。它仅会将S1官方返回的会话令牌 (`sid`) 保存在您浏览器的本地存储中 (`browser.storage.local`)，以便下次使用，该令牌不会离开您的电脑。
3.  **内容处理:** 所有的帖子内容抓取、解析和图片下载都在您的本地浏览器中完成。**任何帖子内容或您的个人数据都不会**发送给插件开发者或任何其他第三方。
4.  **设置存储:** 你的导出偏好设置（如楼层范围）被保存在你本地浏览器的 `localStorage` 中，并与帖子ID关联。

## 从源码构建 (开发者)

本项目使用 [WXT](https://wxt.dev/) 框架构建。

1.  **安装依赖:**
    ```bash
    pnpm install
    ```
2.  **启动开发服务器 (带热重载):**
    ```bash
    pnpm wxt
    ```
    (然后在浏览器中加载 `.wxt/` 目录)
3.  **构建生产版本:**
    ```bash
    pnpm wxt build
    ```
    (构建产物会生成在 `.output/` 目录中)

## 致谢

本插件中用于解锁限制内容（即调用 App API）的部分核心逻辑，参考了以下优秀的油猴脚本：

* **[查看S1不可见内容(审核中/禁言/自动版)](https://greasyfork.org/zh-CN/scripts/419494-%E6%9F%A5%E7%9C%8Bs1%E4%B8%8D%E5%8F%AF%E8%A7%81%E5%86%85%E5%AE%B9-%E5%AE%A1%E6%A0%B8%E4%B8%AD-%E7%A6%81%E8%A8%80-%E8%87%AA%E5%8A%A8%E7%89%88)**

感谢原作者的贡献。

---

<br>

## S1 Markdown Exporter (EN)

This is a modern browser extension (built with WXT) designed to export threads from the Stage1st (S1) forum into structured Markdown files.

It doesn't just scrape the current page; it automatically loads all pages, unblocks restricted content, downloads all images, and converts them into a format suitable for local note-taking apps (like Obsidian).

## Features

* **Full Thread Export:** Automatically fetches all pages and merges the entire thread.
* **Unblock Restricted Content:** Automatically loads restricted content (e.g., "Author banned or deleted," "Content under review").
* **Local Image Downloads:** Automatically downloads all images (attachments and external links) to your local machine.
* **Localized Links:** Converts image links to a local-friendly format. Supports both Obsidian (`![[...]]`) and Standard Markdown (`![](...)`).
* **Preserve Formatting:** Correctly handles S1 quotes, smilies, and user ratings.
* **Flexible Options:** Provides a popup UI to customize the floor range, image download settings, and link format.
* **Settings Memory:** Automatically saves and loads your export preferences for each specific thread.

## Installation (Developer Mode)

This extension is not on any web store. You must install it manually using Developer Mode:

1.  **Download:** On this GitHub repository page, click the green `<> Code` button and select `Download ZIP`.
2.  **Unzip:** Unzip the downloaded `.zip` file into a **permanent** folder on your computer (if you delete this folder, the extension will stop working).
3.  **Open Extensions Page:**
    * **Chrome / Edge:** Type `chrome://extensions` (or `edge://extensions`) into the address bar and press Enter.
    * **Firefox:** Type `about:debugging#/runtime/this-firefox` into the address bar and press Enter.
4.  **Enable Developer Mode:**
    * **Chrome / Edge:** Find the "Developer mode" toggle in the top-right corner and turn it on.
    * **Firefox:** Click the "Load Temporary Add-on..." button.
5.  **Load Extension:**
    * **Chrome / Edge:** Click the "Load unpacked" button that appears in the top-left.
    * **Firefox:** (Already done in Step 4).
6.  **Select Folder (The Most Important Step):**
    In the file dialog, **do not** select the root folder you just unzipped. You must select the specific **`.output`** sub-folder for your browser:

    * **For Chrome / Vivaldi / etc.:**
        `.../S1-Exporter-Plugin-main/.output/chrome-mv3`
    * **For Microsoft Edge:**
        `.../S1-Exporter-Plugin-main/.output/edge-mv3`
    * **For Firefox:**
        `.../S1-Exporter-Plugin-main/.output/firefox-mv2/manifest.json` (Firefox may require you to select the `manifest.json` file directly)

7.  Done! You should now see the **billiard ball icon** in your browser toolbar.

## How to Use

1.  (After installation) Navigate to any S1 thread (e.g., `bbs.saraba1st.com/2b/thread-*-1-1.html`).
2.  Click the extension icon (the **billiard ball**) in your browser toolbar.
3.  Configure your options in the popup. These settings will be **automatically saved** for this specific thread.
4.  Click **"Start Export"**.
5.  **[Login Notice]** If the thread contains restricted content, the extension will show a login prompt. This is necessary to use the **official S1 App API** and requires you to log in to your S1 account separately.
6.  Wait for the process to complete. The Markdown file and images will be automatically saved to your "Downloads" folder.

## Privacy Policy

Your privacy is taken seriously.

1.  **Login Credentials:** When the extension prompts you to log in, your username and password are **only sent directly to the official Stage1st App API** (`app.stage1st.com`) to obtain a session token (`sid`).
2.  **DataStorage:** The extension **never** stores your username or password. It only stores the session token (`sid`) returned by S1 in your browser's local storage (`browser.storage.local`) for future API requests. This token never leaves your computer.
3.  **Content Processing:** All post content scraping, parsing, and image downloading are done **entirely locally** within your browser. **No post content or personal data** is ever sent to the extension developer or any other third party.
4.  **Settings Storage:** Your export preferences (like floor range) are stored in your local browser's `localStorage`, associated with the thread ID.

## Build from Source (For Developers)

This project is built with the [WXT](https://wxt.dev/) framework.

1.  **Install Dependencies:**
    ```bash
    pnpm install
    ```
2.  **Run Dev Server (with HMR):**
    ```bash
    pnpm wxt
    ```
    (Then load the `.wxt/` directory in your browser)
3.  **Build for Production:**
    ```bash
    pnpm wxt build
    ```
    (Build artifacts will be generated in the `.output/` directory)

## Credits

The core logic for unblocking restricted content (by calling the App API) in this extension is based on the work from this excellent Greasy Fork script:

* **[View S1 Invisible Content (Review/Banned/Auto)](https://greasyfork.org/zh-CN/scripts/419494-%E6%9F%A5%E7%9C%8Bs1%E4%B8%8D%E5%8F%AF%E8%A7%81%E5%86%85%E5%AE_A1%E6%A0%B8%E4%B8%AD-%E7%A6%81%E8%A8%80-%E8%87%AA%E5%8A%A8%E7%89%88)**

Thanks to the original author for their contribution.