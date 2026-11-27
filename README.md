# SkillRegistory uTools 插件

基于已确认的产品文档与 GitHub Dark 设计实现的 macOS uTools 插件。插件内置 TypeScript 核心，无需额外安装原 CLI；与 CLI 共用 YAML 配置及中心目录。

使用 Node.js 20.19+：

```sh
npm ci
npm test
npm run build
```

生成构建压缩包：`npm run package`（或 `bash build.sh`）。产物为 `release/SkillRegistory-0.1.0-macos.zip`，另附 SHA-256 和文件清单。压缩包只包含 `dist/` 的运行文件；这是可导入开发者工具的构建包，UPXS 离线安装包的导出方式见[打包说明](docs/PACKAGING.md)。

在 uTools 开发者工具中新建本地插件，选择 **`dist/plugin.json`**。搜索 `SkillRegistory` 或 `技能管理` 打开；也可以选中文件夹，通过“管理此文件夹的 Skills”进入。

首次使用时先初始化全局中心，再选择工作区。已有全局配置会直接读取；选中未初始化的工作区不会自动创建文件，需在界面中确认初始化。

已接入工作区 Skills、Agent 目标及原生目录选择、YAML 编辑与差异确认、增量软链创建、中心本地 / Git 导入、Git 检查与快进更新、共享分组、目标预设和两种作用域的设置。配置保存与链接应用保持分开，移除工作区引用后保留现有链接。

在工作区“Agent 目标”点击 **从预设添加**，可多选 Claude Code、Codex、Cursor 等当前全局预设，预览后创建缺失目录并写入工作区配置。已有目录内容保留，自定义目标路径不会被覆盖；添加目标后，再按需单独预览并应用 Skill 链接。

目标卡片右侧开关通过注释 / 取消注释整个 YAML 块启停；点击卡片可配置路径与独立 Skills 清单。自定义成员支持添加、移除及逐项启停；技能开关切换即保存，无需再点“预览保存”，其他草稿仍按原流程保存；切回继承默认清单时注释保留原清单，恢复时保留每项状态。CLI 与插件的管理保存均保留这些注释。目标启停只依据注释，不读取或迁移 `enable` / `enabled` 配置字段。Skills 页的默认清单与目标使用总览分别显示默认引用和实际有效引用，应用计划按每个启用目标生成。

代码结构：`src/` 为界面，`bridge/` 为 CommonJS preload，`core/` 为文件与 Git 服务，`shared/` 为接口类型，`tests/` 为隔离测试。构建产物自包含，不需要把 `node_modules` 放进插件。

`npm run dev` 只启动界面开发服务器。普通浏览器没有 uTools preload，会提示在宿主中打开，不提供模拟本地写入。实际文件系统测试在临时目录进行，不使用个人全局配置。

当前自动验证覆盖核心文件操作、React 界面流程和编译后桥接层；真实 uTools 宿主中的原生窗口、回收站与安装入口仍需按[宿主验收说明](docs/IMPLEMENTATION.md)验证。首期入口限定 macOS，未声明 Windows 支持。

- [产品需求与范围](docs/PRODUCT.md)
- [交互与视觉规范](docs/DESIGN.md)
- [高保真设计源码](docs/design/skill-registry-prototype.html)
- [工作区初始化交互源码](docs/design/skill-registry-initialization.html)
- [目标独立 Skills 与注释启停（已实施）](docs/TARGET_EVOLUTION_DESIGN.md)
- [实现与宿主验收说明](docs/IMPLEMENTATION.md)
- [图标设计与高清原稿](docs/brand/ICON.md)

`docs/design/` 中的设计稿继续使用虚构数据，仅用于交互对照；实际插件从 `dist/plugin.json` 加载。

插件源代码、构建配置、设计资料与交付物均位于本目录；原 CLI 仓库保持独立。

仓库仅保存源码、测试、构建配置、产品与设计文档，以及必要的插件图标资源。`node_modules/`、`dist/`、`release/`、本机 Skill Registry 配置、代理工具目录和生成的设计预览图片均不提交。设计资源保留 SVG、HTML 模板和导出脚本，按需在本机生成预览。
