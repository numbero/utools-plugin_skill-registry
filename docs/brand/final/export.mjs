import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, writeFile, copyFile } from 'node:fs/promises';

const require = createRequire(import.meta.url);
const { Resvg } = require(process.argv[2] ? path.resolve(process.argv[2]) : '@resvg/resvg-js');
const folder = path.dirname(fileURLToPath(import.meta.url));
const source = await readFile(path.join(folder, 'stack-depot.svg'), 'utf8');
for (const size of [32, 48, 128, 256, 512]) {
  const image = new Resvg(source, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render();
  await writeFile(path.join(folder, `stack-depot-${size}.png`), image.asPng());
}
await copyFile(path.join(folder, 'stack-depot-256.png'), path.resolve(folder, '../../../public/logo-skillregistory.png'));
console.log('黑底白线叠片仓已导出；入口与侧栏共用的 256px PNG 已更新。');
