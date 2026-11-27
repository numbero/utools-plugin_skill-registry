# SkillRegistory 打包说明

当前版本：0.1.0，macOS。

## 构建压缩包

执行 `npm run package` 或 `bash build.sh`。脚本会先进行类型检查与生产构建，再检查 manifest、入口资源及 PNG 图标尺寸，并将运行文件打成 ZIP。

产物：

- `release/SkillRegistory-0.1.0-macos.zip`
- `release/SkillRegistory-0.1.0-macos.zip.sha256`
- `release/SkillRegistory-0.1.0-macos.files.json`

ZIP 顶层为 `SkillRegistory/`，包含 `plugin.json`、`index.html`、`preload.js`、`logo-skillregistory.png`、`package.json` 和 `assets/`。源码、测试、文档、开发依赖、技能目录和项目配置不进入压缩包。

此 ZIP 是构建文件包，不是 UPXS 离线安装包，不能通过改扩展名转换。解压后可以在开发者工具中选择其中的 `plugin.json`；也可以直接使用本工程的 `dist/plugin.json`。

## 导出 UPXS

在 uTools 开发者工具中使用当前项目或创建本地项目：

1. 名称填写 `SkillRegistory`，运行平台选择 macOS。
2. 将生产构建目录设置为本工程的 `dist/`，核对 `plugin.json` 与运行文件。
3. 按技能要求，在真实 uTools 宿主中冷启动检查界面与 preload。
4. 点击“打包”，版本填写 `0.1.0`，版本说明填写“首个本机管理版本：工作区 Skills、Agent 目标、中心仓库、分组、预设及增量链接管理”。
5. 选择保存位置，建议为 `release/SkillRegistory-0.1.0-macos.upxs`。以工具实际生成的格式为准；不通过“发布”或“提交审核”完成本地打包。

当前构建包与自动测试已经完成；本次桌面自动控制连接 uTools 持续超时，尚未导出 UPXS，也尚未完成宿主冷启动验收。

打包流程使用项目内的 [utools-plugin-dev 技能](../.agents/skills/utools-plugin-dev/SKILL.md)。运行时版本以[当前官方架构文档](https://www.u-tools.cn/docs/development/plugin-architecture.html)为准。
