#!/usr/bin/env node
// Builds the signed Android release on this machine: an arm64 APK for GitHub
// Releases and an AAB for Google Play, then attaches the APK and its SHA-256 to a
// draft GitHub release `android-v<version>` (version from app.json).
//
// Usage: npm run --workspace @opencollab/mobile release:android [-- --no-upload]
//
// Needs ANDROID_KEYSTORE_PATH, ANDROID_KEYSTORE_PASSWORD, ANDROID_KEY_ALIAS and
// ANDROID_KEY_PASSWORD (read by plugins/android-release.js; set in the shell or in
// keys/release.env), the Android SDK and
// JDK, and `gh` logged in for the upload. Raise app.json expo.android.versionCode
// for every release; Android and Play refuse a code that isn't higher.
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const mobile = path.join(__dirname, '..')
const android = path.join(mobile, 'android')
const dist = path.join(mobile, 'dist')
const { expo } = require(path.join(mobile, 'app.json'))
const version = expo.version
const tag = `android-v${version}`
const upload = !process.argv.includes('--no-upload')
let repo

const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { cwd: mobile, stdio: 'inherit', ...options })
const read = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { cwd: mobile, encoding: 'utf8', ...options }).trim()
const fail = (message) => {
  console.error(`✗ ${message}`)
  process.exit(1)
}

const env = { ...process.env }
// keys/release.env (gitignored) holds the signing variables on this machine;
// variables already set in the shell win.
const keysEnv = path.join(mobile, 'keys', 'release.env')
if (fs.existsSync(keysEnv)) {
  for (const line of fs.readFileSync(keysEnv, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z_]+)=(.*)$/)
    if (match && !env[match[1]]) env[match[1]] = match[2]
  }
}
env.ANDROID_HOME ||= path.join(os.homedir(), 'Library', 'Android', 'sdk')
const studioJdk = '/Applications/Android Studio.app/Contents/jbr/Contents/Home'
if (!env.JAVA_HOME && fs.existsSync(studioJdk)) env.JAVA_HOME = studioJdk

for (const name of [
  'ANDROID_KEYSTORE_PATH',
  'ANDROID_KEYSTORE_PASSWORD',
  'ANDROID_KEY_ALIAS',
  'ANDROID_KEY_PASSWORD'
]) {
  if (!env[name]) fail(`${name} is not set; refusing to build a debug-signed release`)
}
if (!fs.existsSync(env.ANDROID_KEYSTORE_PATH)) fail(`No keystore at ${env.ANDROID_KEYSTORE_PATH}`)

if (upload) {
  if (read('git', ['status', '--porcelain'])) fail('Commit your changes first: the tree is dirty')
  if (read('git', ['branch', '--show-current']) !== 'main') fail('Release from main')
  run('git', ['fetch', '--quiet'])
  if (read('git', ['rev-parse', 'HEAD']) !== read('git', ['rev-parse', '@{upstream}'])) {
    fail('main is not in sync with GitHub; push or pull first')
  }
  // Without --repo, gh may pick another remote (origin is the upstream template).
  repo = read('git', ['remote', 'get-url', read('git', ['config', 'branch.main.remote'])])
  const releases = read('gh', [
    'release',
    'list',
    '--repo',
    repo,
    '--json',
    'tagName',
    '--jq',
    '.[].tagName'
  ])
  if (releases.split('\n').includes(tag)) fail(`${tag} already exists; raise app.json version`)
}

console.log(`→ OpenCollab ${version} (versionCode ${expo.android.versionCode})`)
// android/ is generated: a clean prebuild applies plugins/android-release.js.
run('npx', ['expo', 'prebuild', '--platform', 'android', '--clean', '--no-install'], { env })
fs.writeFileSync(path.join(android, 'local.properties'), `sdk.dir=${env.ANDROID_HOME}\n`)
// The bundled Bare backend is built for android-arm64 only.
run('./gradlew', ['assembleRelease', 'bundleRelease', '-PreactNativeArchitectures=arm64-v8a'], {
  cwd: android,
  env
})

const outputs = path.join(android, 'app', 'build', 'outputs')
const apk = path.join(outputs, 'apk', 'release', 'app-release.apk')
const aab = path.join(outputs, 'bundle', 'release', 'app-release.aab')

const buildTools = path.join(env.ANDROID_HOME, 'build-tools')
const latest = fs
  .readdirSync(buildTools)
  .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  .pop()
const certs = read(path.join(buildTools, latest, 'apksigner'), ['verify', '--print-certs', apk], {
  env
})
if (/CN=Android Debug/.test(certs)) fail('The APK is signed with the debug key')
console.log(certs.split('\n')[0])

fs.rmSync(dist, { recursive: true, force: true })
fs.mkdirSync(dist)
const name = `OpenCollab-${version}-arm64`
const files = {
  apk: path.join(dist, `${name}.apk`),
  aab: path.join(dist, `${name}.aab`),
  sha: path.join(dist, `${name}.apk.sha256`)
}
fs.copyFileSync(apk, files.apk)
fs.copyFileSync(aab, files.aab)
const digest = crypto.createHash('sha256').update(fs.readFileSync(files.apk)).digest('hex')
fs.writeFileSync(files.sha, `${digest}  ${name}.apk\n`)
console.log(`✓ ${path.relative(process.cwd(), dist)}: APK for GitHub, AAB for Google Play`)

if (!upload) process.exit(0)
run('gh', [
  'release',
  'create',
  tag,
  '--repo',
  repo,
  files.apk,
  files.sha,
  '--draft',
  '--target',
  read('git', ['rev-parse', 'HEAD']),
  '--title',
  `OpenCollab for Android ${version}`,
  '--notes',
  'Android APK for arm64 phones, Android 10 or newer. Open the APK on your phone and allow ' +
    `installing apps from your browser when asked.\n\nSHA-256: \`${digest}\``
])
console.log(`✓ Draft release ${tag} created; review it on GitHub, then publish`)
