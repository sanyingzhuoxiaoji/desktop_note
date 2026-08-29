# 桌面便签 (desktop-sticky-note)

一个用 **Electron + 原生 HTML/CSS/JS** 打造的 Windows 桌面贴纸便签：无边框、可置顶、贴边自动隐藏，集待办清单、图片收藏、皮肤与字体定制于一体。无框架、无构建步骤，源码即全部。

## ✨ 功能特性

- 🗂 **待办清单** —— `Enter` 新增一条，`Ctrl+Enter` 换行，完美兼容中文输入法
- ✅ **状态流转** —— 勾选完成（自动记录 `开始:MM-DD 完成:MM-DD HH:mm`）、悬停放弃、备注、彻底删除，"已完成"折叠区收纳
- 🖼 **图片收藏** —— 截图后直接 `Ctrl+V`，或拖拽图片文件进窗口；自动缩略、点击放大到独立查看窗口
- 🧲 **贴边自动隐藏** —— 未置顶时拖到屏幕左/右边缘，自动收成一条 8px 细边；鼠标悬停滑出，拖离边缘恢复
- 🎨 **皮肤系统** —— 8 种马卡龙预设色 + 任意自定义取色，文字/点缀色按底色自动推导
- 🔤 **字体调节** —— 字体大小、粗细滑杆实时调整，带预览
- 📌 **一键置顶** —— 始终浮在所有窗口之上（贴边隐藏自动停用）
- ⚙️ **设置窗口** —— 左侧目录 + 右侧内容，开机自启一键开关
- 💾 **本地持久化** —— 便签内容、图片、窗口位置大小、全部设置存本地 JSON，重启即恢复

## 🛠 技术栈

| 项 | 说明 |
|---|---|
| 运行时 | Electron 43 |
| 界面 | 原生 HTML / CSS / JavaScript（无框架、无构建步骤） |
| 打包 | electron-builder（NSIS 安装包 + 免安装目录） |
| 数据 | 本地 JSON（`%APPDATA%\desktop-sticky-note\`），原子写入 |

## 🚀 本地开发

```bash
git clone https://github.com/sanyingzhuoxiaoji/desktop_note.git
cd desktop_note
npm install
npm start
```

> 国内网络下 Electron 二进制下载慢或失败时：
>
> ```powershell
> $env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
> npm install
> # 若启动时提示二进制缺失，手动补一次：
> node node_modules/electron/install.js
> ```

## 📦 打包 exe

```powershell
$env:ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/"
$env:ELECTRON_BUILDER_BINARIES_MIRROR="https://npmmirror.com/mirrors/electron-builder-binaries/"
npm run dist
```

产物在 `release\`：

- `桌面便签 Setup x.x.x.exe` —— NSIS 安装包
- `win-unpacked\桌面便签.exe` —— 免安装绿色版

自定义图标：把 `.ico`（≥256×256）放到 `build\icon.ico` 后重新 `npm run dist`。

## 📁 目录结构

```
├── main.js            # 主进程：窗口、置顶、贴边隐藏、持久化、IPC
├── preload.js         # contextBridge 安全桥（window.stickyApi）
├── index.html         # 便签主界面
├── style.css          # 主题与样式（CSS 变量驱动）
├── renderer.js        # 主界面逻辑
├── settings.html/css/js   # 设置窗口（字体 / 开机自启）
├── viewer.html/css/js     # 独立图片查看窗口
├── viewer-preload.js
└── build/             # 打包资源（应用图标）
```

## 💾 数据存储

所有数据保存在本地，不上传任何服务器：

```
%APPDATA%\desktop-sticky-note\
├── sticky-note-data.json   # 便签内容、图片、时间戳
├── app-settings.json       # 字体、开机自启等设置
└── window-state.json       # 窗口位置与大小
```

## 📄 License

[MIT](LICENSE)
