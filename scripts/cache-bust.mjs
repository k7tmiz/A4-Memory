/**
 * 静态资源缓存版本号：以文件内容哈希改写 HTML 入口中的 ?v= 参数。
 *
 *   node scripts/cache-bust.mjs          改写源码 HTML 中过期的版本号
 *   node scripts/cache-bust.mjs --check  只检查，存在过期版本号时以非零状态退出
 *
 * 私有模块不进入公开仓库，其版本号保持手动维护。
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const HTML_ENTRIES = ['index.html', 'records.html', 'settings.html'];
export const MANUAL_REVISION_ASSETS = new Set(['js/cloud.js']);

const ASSET_PATTERN = /((?:src|href)="\.\/)((?:css|js|data)\/[\w./-]+?\.(?:css|js))\?v=([\w-]+)(")/g;

export function computeRevision(relativePath, root = ROOT) {
  // 统一换行符，避免 Windows 检出时 CRLF 改变哈希
  const content = readFileSync(path.join(root, relativePath), 'utf8').replace(/\r\n/g, '\n');
  return createHash('sha256').update(content).digest('hex').slice(0, 10);
}

function rewriteHtml(html, root, onAsset) {
  return html.replace(ASSET_PATTERN, (match, prefix, asset, current, suffix) => {
    if (MANUAL_REVISION_ASSETS.has(asset) || !existsSync(path.join(root, asset))) return match;
    const expected = computeRevision(asset, root);
    onAsset({ asset, current, expected });
    return `${prefix}${asset}?v=${expected}${suffix}`;
  });
}

export function findStaleAssets(root = ROOT) {
  const stale = [];
  for (const html of HTML_ENTRIES) {
    const file = path.join(root, html);
    if (!existsSync(file)) continue;
    rewriteHtml(readFileSync(file, 'utf8'), root, ({ asset, current, expected }) => {
      if (current !== expected) stale.push({ html, asset, current, expected });
    });
  }
  return stale;
}

export function applyRevisions(root = ROOT) {
  const changed = [];
  for (const html of HTML_ENTRIES) {
    const file = path.join(root, html);
    if (!existsSync(file)) continue;
    const source = readFileSync(file, 'utf8');
    const next = rewriteHtml(source, root, ({ asset, current, expected }) => {
      if (current !== expected) changed.push({ html, asset, current, expected });
    });
    if (next !== source) writeFileSync(file, next);
  }
  return changed;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.includes('--check')) {
    const stale = findStaleAssets();
    if (stale.length) {
      for (const { html, asset, current, expected } of stale) {
        console.error(`✗ ${html}: ${asset}?v=${current} → 应为 ${expected}`);
      }
      console.error('缓存版本号已过期，请运行 npm run cache-bust');
      process.exit(1);
    }
    console.log('✓ 缓存版本号与文件内容一致');
  } else {
    const changed = applyRevisions();
    for (const { html, asset, expected } of changed) console.log(`✓ ${html}: ${asset}?v=${expected}`);
    if (!changed.length) console.log('✓ 缓存版本号无需更新');
  }
}
