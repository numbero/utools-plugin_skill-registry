# 最终图标：叠片仓 · 黑底白线

形状沿用已选定的“叠片仓”：双层叠片位于开放仓体内，下方短横线表示取用口。

- 底色：`#000000`。
- 线条：`#FFFFFF`。
- 尺寸基准：256 × 256，线宽 8，圆角线端与连接。
- 外框圆角：56，四角透明。
- 不使用渐变、投影或材质。

`stack-depot.svg` 是矢量源文件；PNG 提供 32、48、128、256、512 像素。插件入口与侧栏共用 `public/logo-skillregistory.png`，由本目录的 256 像素版本生成。

重新导出：

```sh
node docs/brand/final/export.mjs /工具目录/node_modules/@resvg/resvg-js
npm run package
```

`@resvg/resvg-js` 仅用于设计资产导出，插件运行与常规构建不依赖它。此前的立体、扁平形状与配色方案保留作为设计记录。
