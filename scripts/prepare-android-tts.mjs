import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { pathToFileURL } from 'node:url';

export const SHERPA_AAR_VERSION = '1.13.3';
export const SHERPA_AAR_FILENAME = `sherpa-onnx-${SHERPA_AAR_VERSION}.aar`;
export const SHERPA_AAR_URL =
  `https://github.com/k2-fsa/sherpa-onnx/releases/download/v${SHERPA_AAR_VERSION}/` +
  `sherpa-onnx-static-link-onnxruntime-${SHERPA_AAR_VERSION}.aar`;
export const SHERPA_AAR_SHA256 = '9f065fe6f2cab09fd48eaa580097293e077637ad53a5e89c5c58a36509386ac7';
const AAR_MAX_DOWNLOAD_BYTES = 256 * 1024 * 1024;
const AAR_DOWNLOAD_TIMEOUT_MS = 5 * 60 * 1000;

const LIFECYCLE_DEPENDENCY = 'implementation("androidx.lifecycle:lifecycle-process:2.10.0")';
const AAR_DEPENDENCY = `implementation(files("libs/${SHERPA_AAR_FILENAME}"))`;
const PROGUARD_MARKER = '# A4 offline TTS JNI bridge';
const PROGUARD_BLOCK = `${PROGUARD_MARKER}
-keep class app.tauri.A4SpeechBridge { *; }
-keepclassmembers class app.tauri.A4SpeechBridge { *; }
-keep class app.tauri.A4OfflineTtsBridge { *; }
-keepclassmembers class app.tauri.A4OfflineTtsBridge { *; }
-keep class com.k2fsa.sherpa.onnx.** { *; }
`;

function cacheRoot() {
  return path.join(process.env.XDG_CACHE_HOME || path.join(homedir(), '.cache'), 'a4-memory');
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  await pipeline(createReadStream(filePath), hash);
  return hash.digest('hex');
}

async function verifySha256(filePath, expectedSha256) {
  const actual = await sha256File(filePath);
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error(`AAR SHA256 mismatch: expected ${expectedSha256}, got ${actual}`);
  }
}

async function downloadFile(url, destination) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const partial = `${destination}.partial`;
    await rm(partial, { force: true });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AAR_DOWNLOAD_TIMEOUT_MS);
    try {
      const response = await fetch(url, { redirect: 'follow', signal: controller.signal });
      if (!response.ok || !response.body) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const declaredSize = Number(response.headers.get('content-length')) || 0;
      if (declaredSize > AAR_MAX_DOWNLOAD_BYTES) {
        throw new Error(`AAR response is too large: ${declaredSize} bytes`);
      }
      let downloaded = 0;
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          downloaded += chunk.length;
          if (downloaded > AAR_MAX_DOWNLOAD_BYTES) {
            callback(new Error(`AAR download exceeded ${AAR_MAX_DOWNLOAD_BYTES} bytes`));
          } else {
            callback(null, chunk);
          }
        },
      });
      await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(partial));
      await rename(partial, destination);
      return;
    } catch (error) {
      await rm(partial, { force: true });
      lastError = error;
      if (attempt < 3) {
        await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  throw new Error(`Failed to download sherpa-onnx AAR: ${lastError?.message || lastError}`);
}

async function resolveAar({ aarSourcePath, expectedSha256, download = downloadFile } = {}) {
  const expected = (expectedSha256 || SHERPA_AAR_SHA256).toLowerCase();
  if (aarSourcePath) {
    await verifySha256(aarSourcePath, expected);
    return aarSourcePath;
  }

  const dir = cacheRoot();
  const cached = path.join(dir, `sherpa-onnx-static-link-onnxruntime-${SHERPA_AAR_VERSION}.aar`);
  await mkdir(dir, { recursive: true });
  if (existsSync(cached)) {
    try {
      await verifySha256(cached, expected);
      return cached;
    } catch {
      await rm(cached, { force: true });
    }
  }

  await download(SHERPA_AAR_URL, cached);
  try {
    await verifySha256(cached, expected);
  } catch (error) {
    await rm(cached, { force: true });
    throw error;
  }
  return cached;
}

function findBlockClosingBrace(source, blockName) {
  const match = new RegExp(`\\b${blockName}\\s*\\{`).exec(source);
  if (!match) throw new Error(`Cannot find ${blockName} block in build.gradle.kts`);
  const opening = source.indexOf('{', match.index);
  let depth = 0;
  for (let index = opening; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    else if (source[index] === '}') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unclosed ${blockName} block in build.gradle.kts`);
}

function insertBeforeBlockEnd(source, blockName, insertion) {
  const closing = findBlockClosingBrace(source, blockName);
  return `${source.slice(0, closing)}${insertion}${source.slice(closing)}`;
}

function injectGradle(source) {
  let next = source;
  if (!next.includes('abiFilters += listOf("arm64-v8a")')) {
    next = insertBeforeBlockEnd(
      next,
      'defaultConfig',
      '        ndk {\n            abiFilters += listOf("arm64-v8a")\n        }\n    '
    );
  }
  if (!next.includes('androidx.lifecycle:lifecycle-process:2.10.0')) {
    next = insertBeforeBlockEnd(next, 'dependencies', `    ${LIFECYCLE_DEPENDENCY}\n`);
  }
  if (!next.includes(`libs/${SHERPA_AAR_FILENAME}`)) {
    next = insertBeforeBlockEnd(next, 'dependencies', `    ${AAR_DEPENDENCY}\n`);
  }
  return next;
}

export async function prepareAndroidTts({
  projectRoot = process.cwd(),
  androidDir = path.join(projectRoot, 'src-tauri', 'gen', 'android'),
  aarSourcePath,
  expectedSha256 = SHERPA_AAR_SHA256,
  download,
} = {}) {
  const appDir = path.join(androidDir, 'app');
  const gradlePath = path.join(appDir, 'build.gradle.kts');
  if (!existsSync(gradlePath)) {
    throw new Error(`Android project is not initialized: ${gradlePath}`);
  }

  const sourceAar = await resolveAar({ aarSourcePath, expectedSha256, download });
  const libsDir = path.join(appDir, 'libs');
  const bridgeDir = path.join(appDir, 'src', 'main', 'java', 'app', 'tauri');
  await mkdir(libsDir, { recursive: true });
  await mkdir(bridgeDir, { recursive: true });
  await copyFile(sourceAar, path.join(libsDir, SHERPA_AAR_FILENAME));

  for (const bridge of ['A4SpeechBridge.kt', 'A4OfflineTtsBridge.kt']) {
    await copyFile(
      path.join(projectRoot, 'src-tauri', 'android', bridge),
      path.join(bridgeDir, bridge)
    );
  }

  const gradle = await readFile(gradlePath, 'utf8');
  const nextGradle = injectGradle(gradle);
  if (nextGradle !== gradle) await writeFile(gradlePath, nextGradle);

  const proguardPath = path.join(appDir, 'proguard-rules.pro');
  const proguard = existsSync(proguardPath) ? await readFile(proguardPath, 'utf8') : '';
  if (!proguard.includes(PROGUARD_MARKER)) {
    const separator = proguard && !proguard.endsWith('\n') ? '\n\n' : proguard ? '\n' : '';
    await writeFile(proguardPath, `${proguard}${separator}${PROGUARD_BLOCK}`);
  }

  return { prepared: true, androidDir, aarPath: path.join(libsDir, SHERPA_AAR_FILENAME) };
}

export async function prepareAndroidTtsForBuild({
  env = process.env,
  projectRoot = process.cwd(),
  ...options
} = {}) {
  const platform = String(env.TAURI_ENV_PLATFORM || '').toLowerCase();
  if (platform !== 'android' && platform !== 'androideabi') {
    return { prepared: false, reason: 'not-android' };
  }
  const arch = String(env.TAURI_ENV_ARCH || '').toLowerCase();
  if (platform === 'androideabi' || (arch && arch !== 'aarch64')) {
    throw new Error('Android offline TTS builds currently require --target aarch64.');
  }
  return prepareAndroidTts({ projectRoot, ...options });
}

const invokedAsScript = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (invokedAsScript) {
  prepareAndroidTts()
    .then(({ aarPath }) => console.log(`Android offline TTS prepared (${aarPath})`))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
