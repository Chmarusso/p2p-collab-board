#!/usr/bin/env node
// Builds a P2P OTA update for the iOS app: a Hermes bytecode bundle (UI + the
// embedded Bare worker) per iOS host, assembled into a `pear build` deployment
// folder ready for `pear stage <upgrade link> <folder>`.
//
// Usage: npm run --workspace @opencollab/mobile ota [-- <deploymentDir>]
//
// Only JS/worker changes can ship this way; anything native (modules, Pods,
// permissions, React Native/Expo upgrades) needs a new binary. The version in
// package.json must be higher than the installed binary and every earlier OTA.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const mobile = path.join(__dirname, '..')
const pkg = require(path.join(mobile, 'package.json'))
const work = path.join(os.tmpdir(), 'opencollab-mobile-ota')
const target = path.resolve(
  process.argv[2] ||
    path.join(mobile, '..', '..', '..', 'opencollab-deploy', `mobile-${pkg.version}`)
)
// pear build requires each host folder to be named after productName.
const hosts = ['ios-arm64', 'ios-arm64-simulator']

const run = (cmd, args) => execFileSync(cmd, args, { cwd: mobile, stdio: 'inherit' })

fs.rmSync(work, { recursive: true, force: true })
const payload = path.join(work, 'payload', pkg.productName)
fs.mkdirSync(payload, { recursive: true })

// The worker is embedded in the JS bundle, so rebuild it first.
run('npm', ['run', 'bundle:bare'])
run('npx', [
  'expo',
  'export:embed',
  '--platform',
  'ios',
  '--dev',
  'false',
  '--entry-file',
  'index.js',
  '--bundle-output',
  path.join(payload, 'app.bundle'),
  '--assets-dest',
  payload,
  '--bytecode'
])

const args = ['build', '--package', path.join(mobile, 'package.json')]
args.push('--config', path.join(mobile, 'pear.json'), '--target', target)
for (const host of hosts) {
  const dir = path.join(work, host, pkg.productName)
  fs.cpSync(payload, dir, { recursive: true })
  args.push(`--${host}`, dir)
}
fs.rmSync(target, { recursive: true, force: true })
run('pear', args)

console.log(`\n${pkg.productName} ${pkg.version} OTA → ${target}`)
console.log(`Stage it with:\n  pear stage ${pkg.upgrade} ${target}`)
