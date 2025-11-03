import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html
export default defineConfig({
  manifest: {

    name: "S1 Markdown Exporter",
    
    description: "点击插件图标，导出S1帖子为Markdown，解锁内容并流式下载附件。",
    
    permissions: [
      "storage",
      "downloads",
      "scripting",
      "activeTab"
    ],
    

    host_permissions: [
      "https://app.stage1st.com/2b/api/app/*",
      "https://*.stage1st.com/2b/thread-*",
      "https://*.stage1st.com/2b/forum.php*tid=*",
      "https://*.bbs.saraba1st.com/2b/thread-*",
      "https://*.bbs.saraba1st.com/2b/forum.php*tid=*"
    ],
    
    icons: {
      "48": "icon/48.png",
      "128": "icon/128.png"
    }
    
  },
});
