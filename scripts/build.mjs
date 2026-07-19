import { cp, rm, mkdir, readFile, writeFile, readdir } from 'fs/promises';
import { existsSync } from 'fs';
import { prepareAndroidTtsForBuild } from './prepare-android-tts.mjs';

const DIST = 'dist';

const FILES = [
  'index.html',
  'records.html',
  'settings.html',
  'manifest.webmanifest',
];

const DIRS = [
  'css',
  'data',
  'assets',
];

const JS_DIR = 'js';
const CLOUD_JS = 'js/cloud.js';
const CLOUD_STUB = 'js/__cloud_stub.js';
const UPDATER_JS = 'js/updater.js';

await prepareAndroidTtsForBuild();

await rm(DIST, { recursive: true, force: true });
await mkdir(DIST);

await Promise.all(FILES.map(f => cp(f, `${DIST}/${f}`)));
await Promise.all(DIRS.map(d => cp(d, `${DIST}/${d}`, { recursive: true })));

// Copy js/ but exclude both cloud.js (private) and the stub itself.
// cloud.js is placed explicitly below to avoid leaking when present locally.
await mkdir(`${DIST}/${JS_DIR}`, { recursive: true });
async function copyJsTree(src, dest) {
  await mkdir(dest, { recursive: true });
  const entries = await readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = `${src}/${entry.name}`;
    const destPath = `${dest}/${entry.name}`;
    if (srcPath === CLOUD_JS || srcPath === CLOUD_STUB) continue;
    if (entry.isDirectory()) {
      await copyJsTree(srcPath, destPath);
    } else {
      await cp(srcPath, destPath);
    }
  }
}
await copyJsTree(JS_DIR, `${DIST}/${JS_DIR}`);

const hasCloud = existsSync(CLOUD_JS);
if (hasCloud) {
  await cp(CLOUD_JS, `${DIST}/${CLOUD_JS}`);
  console.log('✅  cloud.js included from local file');
} else {
  await cp(CLOUD_STUB, `${DIST}/${CLOUD_JS}`);
  console.warn('⚠  cloud.js not found — using stub (cloud features disabled)');
}

const pkg = JSON.parse(await readFile('package.json', 'utf-8'));
const updaterDist = `${DIST}/${UPDATER_JS}`;
if (existsSync(updaterDist)) {
  let content = await readFile(updaterDist, 'utf-8');
  content = content.replace(/(const\s+APP_VERSION\s*=\s*)"(\d+\.\d+\.\d+)"/, `$1"${pkg.version}"`);
  await writeFile(updaterDist, content);
  console.log(`✅  updater.js → APP_VERSION = ${pkg.version}`);
}

console.log('✅  Build complete → dist/');
