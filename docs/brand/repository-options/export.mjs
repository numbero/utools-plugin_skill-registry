import { createRequire } from 'node:module';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Resvg } = require(process.argv[2] ? path.resolve(process.argv[2]) : '@resvg/resvg-js');
const folder = path.dirname(fileURLToPath(import.meta.url));
const options = JSON.parse(await readFile(path.join(folder, 'options.json'), 'utf8'));
const result = [];
for (const option of options) {
  const source = await readFile(path.join(folder, option.id + '.svg'), 'utf8');
  const images = {};
  for (const size of [32, 48, 128, 256]) {
    const png = new Resvg(source, { fitTo: { mode: 'width', value: size } }).render().asPng();
    await writeFile(path.join(folder, `${option.id}-${size}.png`), png);
    images[size] = 'data:image/png;base64,' + png.toString('base64');
  }
  result.push({ ...option, images });
}
const markup = result.map((option, index) => {
  const x = 190 + (index % 2) * 380, y = 174 + Math.floor(index / 2) * 290;
  return `<image x="${x-64}" y="${y-64}" width="128" height="128" href="${option.images[128]}"/><text x="${x}" y="${y+92}" text-anchor="middle" fill="#E6EDF3" font-size="20">${option.name}</text><text x="${x}" y="${y+117}" text-anchor="middle" fill="#8B949E" font-size="14">${option.description}</text><image x="${x-52}" y="${y+138}" width="32" height="32" href="${option.images[32]}"/><image x="${x+8}" y="${y+130}" width="48" height="48" href="${option.images[48]}"/>`;
}).join('');
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="760" height="700" viewBox="0 0 760 700"><rect width="760" height="700" fill="#010409"/><g font-family="PingFang SC, Microsoft YaHei, sans-serif"><text x="40" y="42" fill="#E6EDF3" font-size="23" font-weight="500">SkillRegistory · 仓库图标方案</text><text x="40" y="68" fill="#8B949E" font-size="14">同一配色与线宽 · 下方为 32px / 48px 预览</text>${markup}</g></svg>`;
await writeFile(path.join(folder, 'comparison.svg'), sheet);
await writeFile(path.join(folder, 'comparison.png'), new Resvg(sheet, { font: { loadSystemFonts: true } }).render().asPng());
const template = await readFile(path.join(folder, 'comparison.template.html'), 'utf8');
if (!template.includes('__REPOSITORY_ICON_OPTIONS__')) throw new Error('图标对比模板缺少数据插槽。');
await writeFile(path.join(folder, 'comparison.html'), template.replace('__REPOSITORY_ICON_OPTIONS__', JSON.stringify(result)));
console.log(`Exported ${options.length} SVG concepts at 32 / 48 / 128 / 256 px, comparison.png and comparison.html`);
