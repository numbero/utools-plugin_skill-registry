import { readFile, readdir, lstat, mkdir, mkdtemp, copyFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distribution = path.join(root, 'dist'), output = path.join(root, 'release');
const project = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const manifest = JSON.parse(await readFile(path.join(distribution, 'plugin.json'), 'utf8'));
const name = 'SkillRegistory';
if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(project.version)) throw new Error('版本号不符合发布命名规则。');
if (process.platform !== 'darwin') throw new Error('当前打包流程面向 macOS，使用系统 ditto 生成 ZIP。');
const basename = `${name}-${project.version}-macos`;
const archive = path.join(output, `${basename}.zip`);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const files = [];

async function collect(folder, relative = '') {
  for (const entry of (await readdir(folder)).sort()) {
    if (entry === '.DS_Store') continue;
    const file = path.join(folder, entry), key = path.posix.join(relative, entry), stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error(`发行目录不得含软链：${key}`);
    if (entry.startsWith('.') || /\.(?:map|log)$/.test(entry)) throw new Error(`发行目录含开发文件：${key}`);
    if (stat.isDirectory()) {
      if (key !== 'assets') throw new Error(`非运行目录：${key}`);
      await collect(file, key);
    } else {
      if (!['index.html', 'plugin.json', 'preload.js', 'package.json', manifest.logo].includes(key) && !/^assets\/[a-zA-Z0-9_.-]+\.(?:js|css|png|jpg|jpeg|svg|woff2?)$/.test(key)) throw new Error(`非运行文件：${key}`);
      const content = await readFile(file); files.push({ path: key, bytes: content.length, sha256: digest(content) });
    }
  }
}
await collect(distribution);
for (const key of ['main', 'preload', 'logo']) if (!files.some(file => file.path === manifest[key])) throw new Error(`缺少入口资源：${key}`);
if (!manifest.features?.length || !manifest.features.some(feature => feature.cmds?.includes(name))) throw new Error('缺少 SkillRegistory 入口指令。');
const logo = await readFile(path.join(distribution, manifest.logo));
if (logo.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || logo.readUInt32BE(16) > 256 || logo.readUInt32BE(20) > 256) throw new Error('logo 必须为不超过 256×256 的 PNG。');
const html = await readFile(path.join(distribution, manifest.main), 'utf8');
for (const match of html.matchAll(/(?:src|href)="\.\/(assets\/[^"?#]+)"/g)) if (!files.some(file => file.path === match[1])) throw new Error(`缺少页面资源：${match[1]}`);

await mkdir(output, { recursive: true });
const staging = await mkdtemp(path.join(output, '.package-'));
try {
  const payload = path.join(staging, name); await mkdir(payload);
  for (const file of files) {
    const destination = path.join(payload, file.path); await mkdir(path.dirname(destination), { recursive: true });
    await copyFile(path.join(distribution, file.path), destination);
  }
  const temporaryArchive = path.join(staging, `${basename}.zip`);
  await execute('/usr/bin/ditto', ['-c', '-k', '--norsrc', '--keepParent', payload, temporaryArchive]);
  await execute('/usr/bin/unzip', ['-t', temporaryArchive]);
  await copyFile(temporaryArchive, archive);
  const bytes = await readFile(archive);
  await writeFile(archive + '.sha256', `${digest(bytes)}  ${path.basename(archive)}\n`);
  await writeFile(path.join(output, `${basename}.files.json`), JSON.stringify({ name, version: project.version, platform: 'darwin', format: 'zip', files }, null, 2) + '\n');
  console.log(`构建压缩包：${archive}（${bytes.length} bytes）`);
  console.log('ZIP 内为独立运行文件；UPXS 离线安装包需通过 uTools 开发者工具从 dist/ 导出。');
} finally { await rm(staging, { recursive: true, force: true }); }
