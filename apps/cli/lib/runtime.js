// Where the CLI runs from. An installed bundle (built by scripts/dist.js and
// installed with `pear install`) carries its own copy of the worker and receives
// OTA updates from its `upgrade` link. From the repo it runs the shared
// workers/main.js with updates off — update a checkout with git instead.
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const bundledWorker = path.join(root, 'workers', 'main.js')
const bundled = fs.existsSync(bundledWorker)
// Name of the app folder under /by-arch/<host>/app/ in the staged drive.
const appName = 'opencollab'

function manifest() {
  return JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
}

module.exports = {
  bundled,
  root,
  appName,
  manifest,
  workerPath: bundled ? bundledWorker : path.join(root, '..', '..', 'workers', 'main.js')
}
