import assert from 'node:assert/strict'
import process from 'node:process'
import WebSocket from 'ws'

const cdpPort = process.env.ELECTRON_CDP_PORT || '9222'

async function evaluate(expression) {
  const targets = await fetch(`http://127.0.0.1:${cdpPort}/json/list`).then((res) => res.json())
  const target = targets.find((entry) => entry.type === 'page')
  assert(target?.webSocketDebuggerUrl, `No Electron page found on CDP port ${cdpPort}`)

  return await new Promise((resolve, reject) => {
    const socket = new WebSocket(target.webSocketDebuggerUrl)
    const id = 1
    socket.on('open', () =>
      socket.send(
        JSON.stringify({
          id,
          method: 'Runtime.evaluate',
          params: { expression, awaitPromise: true, returnByValue: true }
        })
      )
    )
    socket.on('message', (raw) => {
      const message = JSON.parse(raw.toString())
      if (message.id !== id) return
      socket.close()
      if (message.error) return reject(new Error(message.error.message))
      const result = message.result?.result
      if (result?.exceptionDetails) return reject(new Error(result.exceptionDetails.text))
      resolve(result?.value)
    })
    socket.on('error', reject)
  })
}

const result = await evaluate(`(async () => {
  const recent = document.querySelector('#recent-boards button')
  if (!recent) return { error: 'Open Electron, unlock an identity, and show a recent board first.' }
  const expected = recent.innerText
  recent.click()
  for (let attempt = 0; attempt < 30; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 200))
    const actual = document.getElementById('board-name').innerText
    if (actual === expected) return { expected, actual }
  }
  return { expected, actual: document.getElementById('board-name').innerText }
})()`)

assert(!result?.error, result?.error)
assert.equal(result.actual, result.expected)
console.log(`✓ Recent board "${result.expected}" opens with the same title`)
