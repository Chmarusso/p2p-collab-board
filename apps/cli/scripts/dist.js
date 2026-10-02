#!/usr/bin/env node
// Assembles a self-contained CLI bundle for `pear build` / `pear stage`:
//
//   <out>/package.json   version + upgrade link (drives OTA updates)
//   <out>/bin.js …       CLI sources
//   <out>/workers/main.js the shared Bare backend
//   <out>/node_modules   production dependencies for this host only
//
// Usage: node scripts/dist.js [outDir]   (default: <tmpdir>/opencollab-cli-build)
// Build outside the repo: from inside it, Bare would resolve modules from the
// repo's node_modules and hide anything missing from the bundle.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')

const cliDir = path.join(__dirname, '..')
const repo = path.join(cliDir, '..', '..')
const out = path.resolve(
  process.argv[2] || path.join(os.tmpdir(), 'opencollab-cli-build', 'opencollab')
)
const host = `${process.platform}-${process.arch}`

if (path.basename(out) !== 'opencollab') {
  // pear install and the updater look for /by-arch/<host>/app/opencollab.
  throw new Error(`The bundle folder must be named "opencollab" (got ${out})`)
}
if (path.relative(repo, out).split(path.sep)[0] !== '..') {
  throw new Error(`Build the bundle outside the repo (got ${out})`)
}

const cliPkg = require(path.join(cliDir, 'package.json'))
const rootPkg = require(path.join(repo, 'package.json'))

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'workers'), { recursive: true })
for (const entry of ['bin.js', 'index.js', 'lib', 'README.md']) {
  fs.cpSync(path.join(cliDir, entry), path.join(out, entry), { recursive: true })
}
fs.copyFileSync(path.join(repo, 'workers', 'main.js'), path.join(out, 'workers', 'main.js'))

// Every bare specifier the CLI and the worker require, pinned to the version
// installed in the repo so the bundle runs what was tested.
const sources = [
  path.join(repo, 'workers', 'main.js'),
  path.join(cliDir, 'index.js'),
  ...fs.readdirSync(path.join(cliDir, 'lib')).map((file) => path.join(cliDir, 'lib', file))
]
const builtins = new Set(require('module').builtinModules)
const dependencies = {}
for (const file of sources) {
  for (const [, specifier] of fs
    .readFileSync(file, 'utf8')
    .matchAll(/require\('([^'.][^']*)'\)/g)) {
    const name = specifier.startsWith('@')
      ? specifier.split('/').slice(0, 2).join('/')
      : specifier.split('/')[0]
    if (builtins.has(name) || name.startsWith('@opencollab/')) continue
    // Read the hoisted manifest directly: some packages do not export ./package.json.
    const manifest = path.join(repo, 'node_modules', name, 'package.json')
    dependencies[name] = JSON.parse(fs.readFileSync(manifest, 'utf8')).version
  }
}

fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'opencollab-cli',
      productName: 'opencollab',
      version: cliPkg.version,
      upgrade: cliPkg.upgrade,
      private: true,
      bin: { opencollab: './bin.js' },
      main: 'index.js',
      imports: rootPkg.imports,
      dependencies
    },
    null,
    2
  ) + '\n'
)

execFileSync('npm', ['install', '--omit=dev', '--no-audit', '--no-fund', '--no-package-lock'], {
  cwd: out,
  stdio: 'inherit'
})
fs.cpSync(
  path.join(repo, 'packages', 'board-protocol'),
  path.join(out, 'node_modules', '@opencollab', 'board-protocol'),
  { recursive: true }
)

// Drop native prebuilds for other platforms; updates ship per host anyway.
let pruned = 0
const keep = (dir) => dir.startsWith(host) || dir === `${process.platform}-universal`
function prune(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const full = path.join(dir, entry.name)
    if (entry.name === 'prebuilds') {
      for (const target of fs.readdirSync(full)) {
        if (!keep(target)) {
          fs.rmSync(path.join(full, target), { recursive: true, force: true })
          pruned++
        }
      }
    } else prune(full)
  }
}
prune(path.join(out, 'node_modules'))

console.log(`\nopencollab-cli ${cliPkg.version} bundle → ${out}`)
console.log(
  `(${Object.keys(dependencies).length} dependencies, pruned ${pruned} foreign prebuilds)`
)
