import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import process from 'node:process'
import WebSocket from 'ws'

const simulator = process.env.IOS_SIMULATOR_UDID || '6B0BD568-4100-4BBD-9D22-C64F00322CE0'
const cdpPort = process.env.ELECTRON_CDP_PORT || '9222'

function simctl(args, input) {
  return execFileSync('xcrun', ['simctl', ...args, simulator], {
    input,
    encoding: 'utf8'
  }).trim()
}

function hostClipboard(input) {
  if (input !== undefined) execFileSync('pbcopy', { input, encoding: 'utf8' })
  return execFileSync('pbpaste', { encoding: 'utf8' }).trim()
}

function bootstatus() {
  return execFileSync('xcrun', ['simctl', 'bootstatus', simulator, '-b'], {
    encoding: 'utf8'
  }).trim()
}

async function cdp(expression) {
  const targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((res) => res.json())
  const target = targets.find((entry) => entry.type === 'page')
  assert(target?.webSocketDebuggerUrl, `No Electron page found on CDP port ${cdpPort}`)

  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    const id = 1
    socket.on('open', () => {
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true }
        })
      )
    })
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      if (message.id !== id) return
      socket.close()
      if (message.error) return reject(new Error(message.error.message))
      if (message.result?.result?.exceptionDetails)
        return reject(new Error(message.result.result.exceptionDetails.text))
      resolve(message.result?.result?.value)
    })
    socket.on('error', reject)
  })
}

const invite = `clipboard-integration-${Date.now()}`
bootstatus()

const copiedFromElectron = await cdp(`(async () => {
  document.getElementById('modal-invite').innerText = ${JSON.stringify(invite)}
  await document.getElementById('copy-invite').onclick()
  return await navigator.clipboard.readText()
})()`)
assert.equal(copiedFromElectron, invite, 'Electron did not copy the invitation')
assert.equal(hostClipboard(), invite, 'Electron did not update the macOS clipboard')

const copiedFromSimulator = `${invite}-from-simulator`
hostClipboard(copiedFromSimulator)
const pastedIntoElectron = await cdp(`(async () => {
  document.getElementById('room-choice').style.display = 'none';
  document.getElementById('room-join-form').style.display = 'block';
  await document.getElementById('room-invite-paste').onclick()
  return document.getElementById('room-invite').value
})()`)
assert.equal(pastedIntoElectron, copiedFromSimulator, 'Electron did not read the macOS clipboard')

const simulatorClipboard = `${invite}-simulator`
simctl(['pbcopy'], simulatorClipboard)
assert.equal(simctl(['pbpaste']), simulatorClipboard, 'iOS Simulator clipboard roundtrip failed')

console.log('✓ Electron ↔ macOS clipboard transfer')
console.log('✓ iOS Simulator clipboard roundtrip')
console.log(
  '  Note: simctl uses a separate pasteboard; the mobile Paste invitation button reads it directly.'
)
