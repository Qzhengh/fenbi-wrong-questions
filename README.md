# 粉笔错题集生成器

一键从粉笔网报告/解析页抓取错题数据与图片，直接生成 Word 错题集。

GitHub: https://github.com/Qzhengh/fenbi-wrong-questions

## 功能

- 自动拦截粉笔 `solution` / `getReport` 接口
- 自动抓取错题图片（含公式图）
- 浏览器内一键生成 `错题集.docx`
- 保留命令行 fallback（`parse.py` + `build_docx.js`）

## 安装

1. 下载或 clone 本仓库：
   ```bash
   git clone https://github.com/Qzhengh/fenbi-wrong-questions.git
   ```
2. Chrome 地址栏输入 `chrome://extensions`，打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择 `fenbi-grabber/` 文件夹。

## 使用

1. 在 Chrome 打开粉笔「报告 / 解析页」（能看到题目对错和解析的页面）。
2. 等待右下角按钮变绿 `✅(2/2)`。
3. 点击按钮，浏览器自动下载 `错题集.docx`。
4. 用 Word / WPS 打开即可。

> 若 Word 中有少量图片缺失（橙色占位框），可下载同名的 `fenbi-bundle-时间戳.json`，然后走命令行 fallback 手动补图。

## 命令行 fallback

```bash
python3 unbundle.py fenbi-bundle-xxx.json
python3 parse.py solution.txt getReport.txt
node build_docx.js
```

## 文件说明

| 文件 | 说明 |
|------|------|
| `fenbi-grabber/` | Chrome 扩展插件 |
| `parse.py` | 解析数据 + 下图（命令行 fallback） |
| `build_docx.js` | 生成 Word（命令行 fallback） |
| `claim_images.py` | 手动补图后认领回 `errors.json` |
| `unbundle.py` | 解压插件导出的 bundle JSON |
| `PROGRESS.md` | 项目进度记录 |

## 版本

- v0.3.0：纯一键，浏览器内直接生成 Word

## 已知问题与维护备忘

- **缺图**：少量粉笔加密图 canvas 拿不到时，Word 会显示橙色占位框，可下载 bundle 走命令行 fallback 手动补图。
- **粉笔改版风险**：若页面结构或接口 URL 变化，优先检查：
  - `fenbi-grabber/interceptor.js` 中的 `solution` / `getReport` URL 匹配规则
  - `fenbi-grabber/parser.js` 中的 card 树遍历（`nodeType` 1/2）
- **升级 docx 库**：运行 `npm install docx@latest`，然后复制 `node_modules/docx/dist/index.iife.js` 覆盖 `fenbi-grabber/docx.min.js`。

## 注意

- 扩展私钥文件 `fenbi-grabber.pem` 没有上传到 GitHub，请自行妥善保存。
- 项目仅供个人学习整理错题使用。
