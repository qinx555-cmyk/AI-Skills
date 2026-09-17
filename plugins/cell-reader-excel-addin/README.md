# Excel 单元格阅读器

版本：1.1.1。此项目是 Microsoft Excel Office Add-in。

## 获取源码

```bash
git clone https://github.com/qinx555-cmyk/AI-Skills.git
cd AI-Skills/plugins/cell-reader-excel-addin
```

在该目录执行下方安装和构建命令。

这是一个 Excel Office Add-in。打开右侧任务窗格后，每次点击单元格，面板都会自动显示完整内容；你也可以直接编辑文字、选中部分文字设置格式，并同步回原单元格。

## 功能

- 自动跟随当前单元格
- 保留换行并支持长文本滚动
- 显示工作表名、单元格地址和字符数
- 显示格式化内容、原始值及公式
- 在右侧面板直接编辑文本，并自动同步回原单元格
- 选中部分文字，通过稳定的预设色块设置颜色，也可加粗、斜体或添加下划线（需要 ExcelApi 1.18）
- 旧版 Excel 自动降级为整格字体格式
- 公式单元格保持只读，避免意外覆盖公式
- 一键复制完整内容
- 编辑当前单元格后自动刷新（ExcelApi 1.9 及以上）
- 仅在用户编辑时写回当前单元格

## 在 Mac Excel 中安装

需要已安装 Node.js 和桌面版 Microsoft Excel。

```bash
npm install
npm run install:mac
npm start
```

首次执行 `npm start` 时，系统可能要求授权并信任本地 HTTPS 开发证书。完成后：

1. 保持终端中的开发服务器运行。
2. 完全退出 Excel，然后重新打开。
3. 打开任意工作簿。
4. 在 Excel 的“开始”选项卡找到“阅读工具”，点击“查看完整内容”。
5. 点击任意单元格，右侧面板会显示完整内容。

如果按钮没有出现，可在 Excel 中打开“插入 > 获取加载项/我的加载项”，检查“单元格阅读器”是否已加载。

## 常用命令

```bash
npm start      # 启动本地 HTTPS 开发服务器
npm run build  # 类型检查并生成生产文件
```

## Windows 或 Excel 网页版

先运行 `npm start`，然后在 Excel 的“加载项”页面选择“上传我的加载项”，上传项目根目录中的 `manifest.xml`。本地开发地址为 `https://localhost:3000`。

## 正式发布

开发版依赖本机运行 `npm start`。如需让插件在不启动终端的情况下长期使用，请运行 `npm run build`，把 `dist` 目录部署到 HTTPS 网站，并将 `manifest.xml` 中所有 `https://localhost:3000` 替换为正式域名，然后通过 Microsoft 365 管理中心或 AppSource 部署。

## 隐私

加载项只在 Excel 本地会话中读取和更新用户正在编辑的单元格。源码不包含网络上传逻辑，工作簿内容不会发送到第三方服务。

## 许可证

本项目采用 [MIT License](LICENSE)。

## 运行依赖说明

任务窗格从微软 CDN 加载 Office.js；本地开发需要保持 HTTPS 开发服务器运行。插件支持编辑并写回单元格，因此清单申请 `ReadWriteDocument` 权限。
