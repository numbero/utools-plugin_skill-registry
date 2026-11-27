import { createRequire } from 'node:module';
import path from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Resvg } = require(process.argv[2] ? path.resolve(process.argv[2]) : '@resvg/resvg-js');
const folder = path.dirname(fileURLToPath(import.meta.url));
const palettes = JSON.parse(await readFile(path.join(folder, 'palettes.json'), 'utf8'));
const original = await readFile(path.join(folder, '../repository-options/stack-depot.svg'), 'utf8');
if (!original.includes('fill="#0D1117"') || !original.includes('stroke="#58A6FF"')) throw new Error('叠片仓源文件的颜色标记发生变化。');
const result = [];
for (const palette of palettes) {
  const source = original.replace('<title>SkillRegistory · 叠片仓</title>', `<title>SkillRegistory · 叠片仓 · ${palette.name}</title>`).replace('fill="#0D1117"', `fill="${palette.background}"`).replace('stroke="#58A6FF"', `stroke="${palette.stroke}"`);
  await writeFile(path.join(folder, palette.id + '.svg'), source);
  const images = {};
  for (const size of [32, 48, 128, 256]) {
    const png = new Resvg(source, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng();
    await writeFile(path.join(folder, `${palette.id}-${size}.png`), png);
    images[size] = 'data:image/png;base64,' + png.toString('base64');
  }
  result.push({ ...palette, images });
}
const markup = result.map((palette, index) => {
  const x = 150 + (index % 3) * 300, y = 174 + Math.floor(index / 3) * 290;
  return `<image x="${x-64}" y="${y-64}" width="128" height="128" href="${palette.images[128]}"/><text x="${x}" y="${y+92}" text-anchor="middle" fill="#E6EDF3" font-size="20">${palette.name}</text><text x="${x}" y="${y+117}" text-anchor="middle" fill="#8B949E" font-size="14">${palette.description}</text><image x="${x-52}" y="${y+138}" width="32" height="32" href="${palette.images[32]}"/><image x="${x+8}" y="${y+130}" width="48" height="48" href="${palette.images[48]}"/>`;
}).join('');
const sheet = `<svg xmlns="http://www.w3.org/2000/svg" width="900" height="700" viewBox="0 0 900 700"><rect width="900" height="700" fill="#010409"/><g font-family="PingFang SC, Microsoft YaHei, sans-serif"><text x="40" y="42" fill="#E6EDF3" font-size="23" font-weight="500">SkillRegistory · 叠片仓配色</text><text x="40" y="68" fill="#8B949E" font-size="14">同一形状与线宽 · 下方为 32px / 48px 预览</text>${markup}</g></svg>`;
await writeFile(path.join(folder, 'comparison.svg'), sheet);
await writeFile(path.join(folder, 'comparison.png'), new Resvg(sheet, { font: { loadSystemFonts: true } }).render().asPng());
const template = await readFile(path.join(folder, 'comparison.template.html'), 'utf8');
if (!template.includes('__STACK_DEPOT_PALETTES__')) throw new Error('配色对比模板缺少数据插槽。');
await writeFile(path.join(folder, 'comparison.html'), template.replace('__STACK_DEPOT_PALETTES__', JSON.stringify(result)));
console.log(`Exported ${palettes.length} palettes; geometry and stroke width preserved.`);
