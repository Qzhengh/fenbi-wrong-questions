# PROGRESS.md — 进度本

> 用法：每做完一个阶段/小块，在这里记一笔（日期 + 结果 + 验证是否通过）。随时能停、能换对话接力。
>
> 【给接手的 AI / 新会话】本文件就是交接文档：请先**完整读它**，再看同目录代码，然后从「阶段 5」继续。
> 项目全部 file-based，与跑在哪个模型/工具下无关。**下一步很明确**：先在真实粉笔页测试已建好的
> v0.1 抓取插件（`fenbi-grabber/`），拿到 Console 里的「图片诊断」结果，再据此做 v0.2 的图片自动抓取。

## 当前状态（2026-06-15）
- 阶段：**阶段 4 完成**（江西/广东/国考三套卷全部验收通过，两段式工具稳定可用）；**阶段 5 进行中**。
- **阶段 5 v0.2 已实现**：
  - `fenbi-grabber/` 升级到 v0.2.0，新增 `background.js`（Service Worker 跨域取图）。
  - `content.js` 自动收集错题图片 URL，先尝试 `crossOrigin` canvas 快照，失败则 fallback 到 SW `fetch`，最终打包成单个 `fenbi-bundle-时间戳.json`。
  - 新增 `unbundle.py` 解压 bundle 到 `solution.txt` / `getReport.txt` / `images/`。
  - `parse.py` 增加本地已有图片跳过下载逻辑。
  - `fenbi-grabber/安装说明.md` 更新为 v0.2 流程。
  - 代码已过语法/JSON 自检，`parse.py` / `build_docx.js` / `unbundle.py` 均能用现有数据跑通。
- **【已验证】v0.2 端到端跑通**：
  - 真实粉笔页测试：识别 29 张错题图片，全部通过 `crossOrigin` canvas 快照成功抓取（canvas: 29, SW: 0, 失败: 0）。
  - 完整流程 `unbundle.py → parse.py → build_docx.js` 在本项目实测通过，生成 Word 时「所有图片完整，无需手动补」。
  - 之前出现的 3 张「缺图」是因为用旧的 `errors.json` 直接跑 `build_docx.js`，未重新跑 `parse.py`；重新跑一遍后解决。
- **【已完成】v0.2.1 优化**：
  - 用户反馈有时需要多次刷新才能抓到数据。根因是 `getReport` 重抓会报 `"无效DeviceSid"`，fallback 不可行。
  - 通过 `chrome.scripting.executeScript({ injectImmediately: true })` 在 `webNavigation.onCommitted` 时最早注入 `interceptor.js`，实现首次打开页面按钮即变绿 `(2/2)`，无需刷新。
  - 完整流程 `unbundle.py → parse.py → build_docx.js` 验证通过，Word 无缺失。
- 现有「两段式」主流程（已在三套卷验证）：
  1. 浏览器导出 `solution.txt` + `getReport.txt`（v0.1 插件可一键代替这步）
  2. `python3 parse.py solution.txt getReport.txt`（解析 + 下图 + 出 `errors.json` + `images/`）
  3.（按需）补加密图 → `python3 claim_images.py` 认领回 `errors.json`
  4. `node build_docx.js`（出 `错题集.docx`；有缺图同时出 `缺图清单.txt`）

## 项目文件清单
- `parse.py` —— 第1步：解析数据 + 下图 + 出 errors.json
- `build_docx.js` —— 第2步：读 errors.json 排版出 Word（纯排版，不联网）
- `claim_images.py` —— 手动补图后「认领」回 errors.json（按 md5 文件名）
- `README_操作清单.md` —— 给最终用户的两段式操作手册
- `fenbi-grabber/` —— 【新·阶段5】Chrome 抓取插件 v0.1
  - `manifest.json`、`interceptor.js`（MAIN 世界拦截 fetch/XHR）、`content.js`（按钮+导出+图片诊断）、`安装说明.md`
- `PROGRESS.md` —— 本文件

## 阶段勾选
- [x] 阶段 0：侦察 + 可行性关卡（go/no-go）✅
- [x] 阶段 1：识别做对（江西卷：32 道错题，5 板块，资料分析 5 道挂材料正确）✅
- [x] 阶段 2：排版成 Word（江西卷成品图文全部正常）✅
- [x] 阶段 3：放大走阶梯（江西/广东/国考三套排版正常）✅
- [x] 阶段 4：收尾质检（四层）—— 三套卷全部通过 ✅
- [x] 阶段 5：封装「抓取插件」（方案 B）—— 已验证 ✅
- [~] **阶段 6：纯一键方案 C —— v0.3.0 已建(未测)，进行中 ← 当前**

## 阶段 5 进展（方案 B：半插件/浏览器抓取器）✅
**目标**：消灭两大摩擦点——手动导 txt、手动补加密图。**排版引擎不动**，仍用现有 parse+build。

**已完成**：
- v0.1：Chrome MV3 插件，拦截 solution / getReport，导出 txt，图片诊断。
- v0.2：自动收集错题图片 URL，双轨取图（crossOrigin canvas + SW fetch fallback），输出 bundle JSON。
- v0.2.1：解决首次加载需多次刷新问题，通过 `injectImmediately` 最早注入拦截器，实现打开页面即变绿 (2/2)。
- 本地 `unbundle.py → parse.py → build_docx.js` 流程验证通过，Word 无缺失。

## 阶段 6（进行中）★当前
**目标**：纯一键方案 C —— 浏览器内直接生成 `错题集.docx`， eliminating 命令行步骤。

**已做（v0.3.0，待真实页验证）**：
- 引入 `docx` 浏览器构建（`fenbi-grabber/docx.min.js`，IIFE，约 1.1MB）。
- 新建 `parser.js`：在浏览器内复刻 `parse.py` 的 card 树遍历、HTML 拆 parts、错题筛选。
- 新建 `docx-builder.js`：在浏览器内复刻 `build_docx.js` 的排版、图片嵌入、答案页、缺图占位。
- 改造 `content.js`：抓到数据+图片后，调用 `FenbiParser.buildItems` + `FenbiDocxBuilder.buildDocx`，用 `docx.Packer.toBlob` 直接下载 `错题集.docx`；同时下载 bundle 备份。
- 更新 `manifest.json` v0.3.0，注入新脚本；更新 `安装说明.md`；本地 `parse.py` / `build_docx.js` 保留为 fallback。

**立即下一步（必须在真实粉笔页验证）**：
1. Chrome `chrome://extensions` 里刷新插件。
2. 打开粉笔报告/解析页，等按钮变绿 `(2/2)`。
3. 点按钮，浏览器下载 `错题集.docx` + bundle 备份。
4. 打开 Word 检查：
   - 标题、题号、板块正确
   - 图片/公式正常显示
   - 答案页在末尾
   - 无缺失或仅少量缺失
5. 把结果发回：成功/失败、缺图数量、Console 里 `[FENBI-GRABBER]` 相关错误。

**风险/边界**：浏览器内生成 docx 体积较大；公式 inline 排版需完整复刻；缺图时 Word 仍有占位框。

## 数据来源结论（阶段0产出，关键！）
- **题目素材** 来自 `solution` 请求：每题 `solutions[]` 含 `globalId`(题号) / `content`(题干HTML) / `accessories`(选项,type101文字/102图片) / `correctAnswer`(标准答案,choice) / `solution`(解析HTML) / `source`(出处) / `keypoints`(考点) / `type`。
- **资料分析共享题干** 在 `materials[]`(含 `globalId` / `content` 含 `<img>`)；题目通过 `card` 树里的 `materialKeys` 关联到 material。
- **板块 / 顺序** 来自 `card` 树：nodeType=1 是板块(name/questionCount)，nodeType=2 是题(key/materialKeys)。注意 nodeType 子节点是字符串 '1'/'2'。
- **对错 / 作答状态** 来自 `getReport` 的 `data.userAnswers`：题号(key) -> `status` + `scoreRate`。
- **判定规则（已锁死）**：status=1 做对（不收）；status=-1 做错（**收**）；status=10 没作答（**不收**）。
- `getMark` 无关(ids 空)，排除。

## 关键决策记录
- **D1** 答案放法 = a（正文只放题，答案解析统一在文末答案页）。
- **D2** 架构 = 先两段式分开，做稳后再评估合并；用户更想要一键但先求稳。
- **D3** 图片处理 = 方案甲（脚本自动从粉笔下载图片并嵌入 Word）。因沙箱断网，真正下图由用户在自己电脑的 Claude Code 里跑。
- **D4** 题号 = 每题标来源题号 / 板块（如「判断推理·原卷第 X 题」），方便回粉笔对答案。
- **D5** 图片尺寸 = 方案甲：按原比例缩放，限最大宽度（页面可用宽度 ~70%，约 4.5 英寸），大图缩小、小图保持原样。
- **D6** 公式排版 = 方案 B 全行内混排（2026-06-14）：公式作行内图片嵌入文字流，文字 + 公式同段落自动折行，公式高度 26px。替代原方案 A（独立成行），因资料分析解析常「文字+公式+文字+公式」交替，独立成行会持续卡顿。
- **D7** 阶段 5 方向 = **方案 B（半插件 / 抓取器）**（2026-06-15）：插件只抓数据 + 已解密图片，排版仍用现有已验证的 parse+build。理由：消灭手动补加密图与手动导 txt 两大摩擦点，同时不动千锤百炼的排版引擎，风险小、好维护；与 D2「先做稳再合并」一致。方案 C（全插件真一键）留作阶段 6，B 验证后再评估。

## 重要修正记录（小样阶段抓到，未流入全量）
- 【修正-1】`correctAnswer.choice` 是 **0-based**：0=A,1=B,2=C,3=D（全卷 130 题统计一致 A/B/C/D=23/27/44/36）。早前误按 1=A，已改正。
- 【修正-2】图形推理选项图常与题干图画在同一张图里，数据里选项存成「A/B/C/D」占位文字 → 正文不再单列文字选项，看题干图即可。
- 【修正-3】题号用**全卷连续号**（按 card 顺序从 1 起），非板块内序号。`source` 字段是题目原始出处（≠本卷题号），不可用作题号。
- 【修正-4】题目按**全卷题号升序**排列（判断推理在资料分析之前），非字母序。
- 【修正-5】**数学公式也是图片**！粉笔把公式渲染成 `formulas?latex=...` 的图片，必须取到图才完整。下载逻辑已一并接住（与普通图同路径）。
- 【阶段4补·三套卷质检中修掉并回归验证的问题】答案错位、PNG 损坏、坏图漏报、local 漏报、补图认领、公式换行、段落分段、首行缩进。均「小范围发现 → 当场修 → 回归验证」，未攒到最后爆雷，也未靠手动兜底。

## 日志
- 2026-xx-xx 建立 PLAN.md / PROGRESS.md，方案确认，进入阶段 0。
- 2026-06-14 D6 公式改全行内混排；修一系列排版问题。
- 2026-06-15 阶段 4 完成（江西/广东/国考三套验收通过）；决策 D7 选方案 B；进入阶段 5。
- 2026-06-15 建好 v0.1 抓取插件（`fenbi-grabber/`），过语法自检，**尚未真实测试**；项目迁移到本地 Claude Code 继续。下一步：测 v0.1 → 收图片诊断 → 做 v0.2 图片自动抓取。
