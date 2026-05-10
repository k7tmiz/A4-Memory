import { cp, rm, mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';

const DIST = 'dist';

const FILES = [
  'index.html',
  'records.html',
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

// Clean and recreate dist
await rm(DIST, { recursive: true, force: true });
await mkdir(DIST);

// Copy top-level files
await Promise.all(FILES.map(f => cp(f, `${DIST}/${f}`)));

// Copy directories
await Promise.all(DIRS.map(d => cp(d, `${DIST}/${d}`, { recursive: true })));

// Copy js/ directory
await cp(JS_DIR, `${DIST}/${JS_DIR}`, { recursive: true });

// cloud.js handling:
// - If cloud.js exists → already copied above, just remove the stub from dist
// - If cloud.js does NOT exist → copy the stub as cloud.js in dist
const hasCloud = existsSync(CLOUD_JS);

// Always remove the stub from dist (not needed at runtime)
try { await rm(`${DIST}/${CLOUD_STUB}`); } catch { /* not in dist */ }

if (!hasCloud) {
  await cp(CLOUD_STUB, `${DIST}/${CLOUD_JS}`);
  console.warn('⚠  cloud.js not found — using stub (cloud features disabled)');
}

// Inject version from package.json into updater.js
const pkg = JSON.parse(await readFile('package.json', 'utf-8'));
const updaterDist = `${DIST}/${UPDATER_JS}`;
if (existsSync(updaterDist)) {
  let content = await readFile(updaterDist, 'utf-8');
  content = content.replace('"__A4_VERSION__"', `"${pkg.version}"`);
  await writeFile(updaterDist, content);
  console.log(`✅  updater.js → APP_VERSION = ${pkg.version}`);
}

console.log('✅  Build complete → dist/');
