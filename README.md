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

生成 `dist\wallpaper_box-1.0.0-portable.exe`。无需安装，下载后可直接双击运行，适合临时使用、测试或放入 U 盘。

### 同时生成两个版本

```powershell
npm run dist
```
