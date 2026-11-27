# SkillRegistory 立体图标探索（存档）

此立体方向已根据反馈转为存档。形状已选定“叠片仓”，最新评审为[叠片仓配色](stack-depot-colors/README.md)；此前的[仓库语义候选](repository-options/README.md)与[六个扁平方案](flat-options/README.md)保留对照，待配色选定后再替换插件运行图标。

主标记是一条连续的 S 形链路：两端通过同一个主体相连，呼应中心内容复用与软链连接。石墨色圆角底与 GitHub Dark 界面相配，冷蓝色主体以浅青高光区分转折，保留少量切削质感。没有文字、细线或额外节点，以维持小尺寸辨识度。

![SkillRegistory 图标](skillregistory-icon-512.png)

## 交付文件

- `skillregistory-icon-master.png`：生成原稿，保留原始分辨率与透明度。
- `skillregistory-icon-512.png`：512 × 512 预览。
- `skillregistory-icon-32.png`、`skillregistory-icon-48.png`：小尺寸检查稿。
- `skillregistory-sculpted-256.png`：当时的 256 × 256 PNG，保留为历史归档。

原 `public/logo.png` 保留为旧占位图；新构建只带入 manifest 指定的新图标。

## 生成记录

使用 `imagegen` 内置工具生成，非 CLI。导出仅做等比例尺寸缩放，未对生成图案作二次绘制。最终提示词如下：

> Use case: logo-brand. Asset type: final premium macOS launcher app icon for SkillRegistory, a developer tool that keeps one central collection of agent skills linked to many workspaces. Design concept: 'one source, many links'. Create ONE finished app icon, not a concept sheet. The central mark is a distinctive abstract S made from three interlocking rounded geometric modules and short integrated connecting bridges: a larger shared core and two smaller terminal modules, fused into one compact, flowing S-shaped silhouette. Make the connections feel structural, like beautifully engineered joinery, not thin network wires. No separate floating satellite dots, no branching flowchart, no arrows. The symbol should be bold and simple enough to remain legible at 24–32 pixels. Style: disciplined, high-end utility software identity, slightly dimensional machined/anodized material with shallow bevels and restrained soft lighting, almost orthographic front view; exact geometry, generous negative space, balanced optical weight, not glossy toy plastic. Palette fits GitHub Dark: deep graphite squircle tile (#0D1117 with extremely subtle tonal depth), saturated cobalt and cool sky blue (#58A6FF) for the sculpted mark, one restrained icy cyan highlight. The S emblem occupies approximately 66–70 percent of the tile, fully centered. The dark squircle tile fills most of the square canvas with a very small even outer margin; genuinely transparent outside the squircle's rounded corners. Beautiful crisp antialiased edges; no cast shadow outside the icon. Deliver the actual square icon artwork only. No text, no lettering beyond the abstract S-shaped emblem, no app name, no wordmark, no surrounding scene, no mockup, no border frame, no watermark. Avoid purple, neon bloom, lens flare, excessive gradients, fine detail, generic circuit-board graphics, stacked paper/layer icons, or a literal folder.
