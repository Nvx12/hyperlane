// Runs the Android Gradle build with a suitable JDK and SDK, without requiring global
// JAVA_HOME/ANDROID_HOME changes:
//   node tools/android.mjs apk     → debug APK      (assembleDebug)
//   node tools/android.mjs aab     → release bundle (bundleRelease; signed if signing is set up)
//   node tools/android.mjs release → release APK    (assembleRelease)
// JDK: JAVA_HOME if it is a JDK 21+, else the first JDK 21+ found in the usual install places
// (Temurin/Oracle/Microsoft installs, %LOCALAPPDATA%\Programs, Android Studio's bundled JBR).
import { existsSync, readdirSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ANDROID = join(ROOT, 'android');
const TASKS = { apk: 'assembleDebug', aab: 'bundleRelease', release: 'assembleRelease' };
const OUTPUTS = {
  apk: 'app/build/outputs/apk/debug',
  aab: 'app/build/outputs/bundle/release',
  release: 'app/build/outputs/apk/release',
};
const mode = process.argv[2] || 'apk';
if (!TASKS[mode]) {
  console.error(`usage: node tools/android.mjs ${Object.keys(TASKS).join(' | ')}`);
  process.exit(1);
}
const win = process.platform === 'win32';
const exe = name => (win ? `${name}.exe` : name);

// Major version of the JDK at `home` (0 if none). `java -version` prints to stderr.
function javaMajor(home) {
  const java = join(home, 'bin', exe('java'));
  if (!existsSync(java)) return 0;
  const r = spawnSync(java, ['-version'], { encoding: 'utf8' });
  const m = /version "(\d+)/.exec(`${r.stdout}${r.stderr}`);
  return m ? Number(m[1]) : 0;
}

function findJdk() {
  const candidates = [];
  if (process.env.JAVA_HOME) candidates.push(process.env.JAVA_HOME);
  const roots = win
    ? [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs')]
      .filter(Boolean).flatMap(p => ['Eclipse Adoptium', 'Java', 'Microsoft', 'Zulu', ''].map(v => join(p, v)))
    : ['/usr/lib/jvm', '/Library/Java/JavaVirtualMachines', join(homedir(), '.sdkman/candidates/java')];
  for (const root of roots) {
    if (!existsSync(root)) continue;
    for (const name of readdirSync(root)) {
      if (!/jdk|temurin|openjdk|zulu/i.test(name)) continue;
      const home = join(root, name);
      candidates.push(existsSync(join(home, 'Contents', 'Home')) ? join(home, 'Contents', 'Home') : home);
    }
  }
  const studio = win ? [join(process.env.ProgramFiles || '', 'Android', 'Android Studio', 'jbr')] : ['/Applications/Android Studio.app/Contents/jbr/Contents/Home', '/opt/android-studio/jbr'];
  candidates.push(...studio);
  for (const home of candidates) if (javaMajor(home) >= 21) return home;
  return null;
}

function findSdk() {
  const list = [process.env.ANDROID_HOME, process.env.ANDROID_SDK_ROOT,
    win ? join(process.env.LOCALAPPDATA || '', 'Android', 'Sdk') : join(homedir(), 'Library/Android/sdk'), join(homedir(), 'Android/Sdk')];
  return list.find(p => p && existsSync(join(p, 'platform-tools'))) || null;
}

const jdk = findJdk();
if (!jdk) {
  console.error('No JDK 21+ found. Install one (e.g. Eclipse Temurin 21) or set JAVA_HOME to it.');
  process.exit(1);
}
const sdk = findSdk();
if (!sdk) {
  console.error('Android SDK not found. Install Android Studio (or the command-line tools) and set ANDROID_HOME.');
  process.exit(1);
}
// local.properties (git-ignored) tells Gradle where the SDK is.
const localProps = join(ANDROID, 'local.properties');
const sdkLine = `sdk.dir=${sdk.replace(/\\/g, '\\\\').replace(/:/g, '\\:')}`;
if (!existsSync(localProps) || !readFileSync(localProps, 'utf8').includes(sdkLine)) writeFileSync(localProps, `${sdkLine}\n`);

console.log(`JDK ${jdk}\nSDK ${sdk}\n> gradlew ${TASKS[mode]}`);
const gradlew = join(ANDROID, win ? 'gradlew.bat' : 'gradlew');
const env = { ...process.env, JAVA_HOME: jdk, ANDROID_HOME: sdk, PATH: `${join(jdk, 'bin')}${win ? ';' : ':'}${process.env.PATH}` };
// Windows: JDK 16+ uses AF_UNIX sockets (in the temp folder) for every NIO Selector, which Gradle
// needs. On some machines AF_UNIX connects fail under AppData (seen with security/filter software:
// "Unable to establish loopback connection"), so the sockets go to the Gradle user home instead.
if (win) {
  const sockets = join(homedir(), '.gradle', 'nv-uds');
  mkdirSync(sockets, { recursive: true });
  env.JAVA_TOOL_OPTIONS = `${process.env.JAVA_TOOL_OPTIONS || ''} -Djdk.net.unixdomain.tmpdir=${sockets}`.trim();
}
const r = spawnSync(gradlew, [TASKS[mode], '--console=plain'], { cwd: ANDROID, env, stdio: 'inherit', shell: win });
if (r.status !== 0) process.exit(r.status || 1);
const outDir = join(ANDROID, OUTPUTS[mode]);
const files = existsSync(outDir) ? readdirSync(outDir).filter(f => /\.(apk|aab)$/.test(f)) : [];
for (const f of files) console.log(`OUTPUT ${join(outDir, f)}`);
