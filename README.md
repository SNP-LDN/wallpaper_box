# 壁纸盒

<img src="assets/logo.png" alt="壁纸盒 Logo" width="180" />

一个用于管理 Wallpaper 下载文件的轻量桌面应用。它不会联网，也不会抓取壁纸；只读取你选择的本地目录。

## 使用

在本目录执行：

```powershell
npm install
npm start
```

首次打开时选择 Wallpaper 的保存根目录。应用会读取该目录下的一级文件夹，并展示其中存在下列预览文件的壁纸：

## 下载链接

- GitHub：https://github.com/SNP-LDN/wallpaper_box
- 百度网盘：https://pan.baidu.com/s/5_e1z8bEEHWcTm48az00-PA
- 夸克云：https://pan.quark.cn/s/1c8894a8bc1a

- `preview.jpg` / `preview.jpeg`
- `preview.png`
- `preview.gif`

GIF 会直接以动图形式显示。应用会记住上次选择的目录；点击“刷新”可重新扫描。

每张卡片可以标记“喜欢”、加入一个或多个自建收藏夹、打开对应文件夹、修改应用内的显示名称，或删除整个本地壁纸文件夹。喜欢、收藏夹与显示名称都会被保存，且不会改动真实文件夹或其中的文件；删除不可恢复。

## 发布与封装

封装前先安装项目依赖：

```powershell
npm install
```

### 安装版（推荐给普通用户）

```powershell
npm run dist:installer
```

生成 `dist\wallpaper_box-1.0.0-setup.exe`。用户运行后会经过安装步骤，并创建带壁纸盒 Logo 的桌面和开始菜单快捷方式。

### 便携版（免安装）

```powershell
npm run dist:portable
```

生成 `dist-portable\wallpaper_box-版本号-portable.exe`。无需安装，下载后可直接双击运行，适合临时使用、测试或放入 U 盘。

### 默认生成安装版

```powershell
npm run dist
```

`npm run dist` 默认只生成安装版，避免便携版打包时因为 Windows、OneDrive 或杀毒软件占用 `dist\win-unpacked` 导致失败。

安装版支持应用内检查、下载和重启安装更新。便携版不支持应用内更新；如果发布了新版便携版，用户需要重新下载新的 `portable.exe`。
