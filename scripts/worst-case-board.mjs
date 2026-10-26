// Fills a running dev app with a worst-case board: a 100-character board name,
// a 48-character display name, 60-character columns, 200-character and unbroken
// titles, RTL and CJK text, 20 labels on one card, 60 comments, 150 cards in one
// column, past and far-future due dates. It goes through the same worker
// commands as the UI, on a throwaway in-memory identity (no keychain).
//
//   npm start -- --storage /tmp/worst --remote-debugging-port 9222
//   node scripts/worst-case-board.mjs [port]
import process from 'node:process'

const port = process.argv[2] || '9222'
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((res) => res.json())
const target = targets.find((entry) => entry.type === 'page')
if (!target) throw new Error(`No app page on CDP port ${port}`)

// Runs inside the renderer, at the identity screen.
const seed = `(async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms))
  const until = async (label, fn, ms = 30000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await wait(80) } throw new Error('timeout: ' + label) }
  const send = (m) => window.bridge.writeWorkerIPC('/workers/main.js', JSON.stringify(m))
  let state = null
  window.bridge.onWorkerIPC('/workers/main.js', (d) => { try { const m = JSON.parse(new TextDecoder().decode(d)); if (m.type === 'board-state') state = m; if (m.type === 'room-status' && m.invite) window.__invite = m.invite } catch {} })
  try {
  send({ type: 'identity:create-mobile' })
  await until('room gate', () => document.getElementById('room-gate').style.display === 'block')
  document.getElementById('room-create-choice').click()
  document.getElementById('room-name').value = 'Northwind Industries — Q4 2026 Product Launch & Partner Enablement Program (EMEA + APAC)'
  document.getElementById('room-create').click()
  await until('profile', () => document.getElementById('profile-gate').style.display === 'block')
  document.getElementById('display-name').value = 'Aleksandra Wiśniewska-Kowalczyk'
  document.getElementById('display-name-save').click()
  await until('columns', () => state?.columns?.length === 3)
  for (const name of ['Waiting on legal review (external counsel, ETA unknown)', 'QA', 'Backlog — nice to have, revisit after launch', 'Q', 'Blocked 🚧', 'Ready for release train', 'Post-launch follow-ups'])
    send({ type: 'board:column-create', name })
  await until('cols', () => state.columns.length === 10)
  const labelNames = ['Needs design review before engineering', 'bug', 'P0', '🔥 hotfix', 'customer-reported', 'legal', 'security', 'iOS', 'Android', 'web', 'docs', 'billing', 'EU', 'APAC', 'accessibility', 'performance', 'tech debt', 'Q4', 'design', 'blocked by vendor']
  const labelIds = labelNames.map((name, i) => { const id = 'label:' + (100000000000 + i).toString(16).padStart(12, '0'); send({ type: 'board:label-upsert', labelId: id, name, color: ['#4bce97','#f5cd47','#fea362','#f87168','#9f8fef','#579dff','#6cc3e0','#94c748','#e774bb','#8590a2'][i % 10] }); return id })
  await until('labels', () => state.labels.length === 20)
  const titles = [
    ['col:new', 'Migrate the customer-facing billing portal from the legacy Stripe Checkout integration to Payment Element, including SCA/3DS2 flows for EU customers, and update every affected help-center article'],
    ['col:new', 'https://northwind-industries-holdings.example.com/projects/q4-launch/requirements/billing-portal-migration-v2-final'],
    ['col:new', 'Q'],
    ['col:new', '🚀🔥 Launch!!!'],
    ['col:new', 'Обновить документацию по API для партнёров'],
    ['col:new', 'ローンチ前の最終確認とリリースノートの翻訳'],
    ['col:new', 'مراجعة الترجمة العربية لصفحة الهبوط'],
    ['col:doing', 'Ask bartholomew.fitzgerald@northwind-industries-holdings.example.com about the SSO metadata'],
  ]
  for (const [columnId, title] of titles) send({ type: 'board:create', title, body: '', columnId })
  await until('cards', () => state.objects.length === titles.length)
  const byTitle = (t) => state.objects.find((o) => o.title.startsWith(t))
  // 20 labels + overdue on the long card; far-future on the URL card
  send({ type: 'board:card-update', objectId: byTitle('Migrate').id, labelIds, dueDate: '2024-01-15' })
  send({ type: 'board:card-update', objectId: byTitle('https://').id, labelIds: labelIds.slice(0, 3), dueDate: '2031-12-31T23:30:00.000Z' })
  send({ type: 'board:card-update', objectId: byTitle('Q').id, labelIds: [labelIds[3]], dueDate: new Date().toISOString().slice(0, 10) })
  // description: wide table, long code line, long URL
  send({ type: 'board:card-update', objectId: byTitle('Migrate').id, body: '## Scope\\n\\nSee https://northwind-industries-holdings.example.com/projects/q4-launch/requirements/billing-portal-migration-v2-final/appendix-b-eu-sca-exemptions-and-fallbacks.pdf\\n\\n| Region | Provider | SCA | Fallback | Owner | Status | Notes |\\n|---|---|---|---|---|---|---|\\n| EU | Stripe | 3DS2 | SMS OTP | Aleksandra Wiśniewska-Kowalczyk | In review | Waiting on counsel for the exemption list |\\n\\n\`\`\`js\\nconst session = await stripe.checkout.sessions.create({ mode: "payment", payment_method_types: ["card", "sepa_debit", "ideal"], line_items: items })\\n\`\`\`' })
  // 60 comments on one card, one huge unbroken comment
  const longCard = byTitle('Migrate').id
  send({ type: 'board:comment', objectId: longCard, text: 'https://northwind-industries-holdings.example.com/projects/q4-launch/requirements/billing-portal-migration-v2-final/appendix-b-eu-sca-exemptions-and-fallbacks-including-uk-and-switzerland.pdf' })
  send({ type: 'board:comment', objectId: longCard, text: 'Lorem '.repeat(600) })
  for (let i = 0; i < 58; i++) send({ type: 'board:comment', objectId: longCard, text: \`Update \${i + 1}: checked with legal\` })
  send({ type: 'board:vote', objectId: longCard, value: 1 })
  // huge column: 150 cards in QA
  const qa = state.columns.find((c) => c.name === 'QA').id
  for (let i = 0; i < 150; i++) send({ type: 'board:create', title: \`Regression check #\${i + 1}\`, body: '', columnId: qa })
  // one archived card
  send({ type: 'board:create', title: 'Old idea', body: '', columnId: 'col:done' })
  await until('all', () => state.objects.length === titles.length + 151 && state.objects.find((o) => o.id === longCard).comments.length === 60, 60000)
  send({ type: 'board:card-archive', objectId: byTitle('Old idea').id, archived: true })
  await wait(800)
  return { invite: window.__invite, cards: state.objects.length, cols: state.columns.length }
  } catch (e) { return { error: e.message } }
})()`

const socket = new WebSocket(target.webSocketDebuggerUrl)
await new Promise((resolve) => socket.addEventListener('open', resolve))
socket.send(
  JSON.stringify({
    id: 1,
    method: 'Runtime.evaluate',
    params: { expression: seed, awaitPromise: true, returnByValue: true }
  })
)
const reply = await new Promise((resolve) =>
  socket.addEventListener('message', (event) => resolve(JSON.parse(event.data)))
)
socket.close()
const result = reply.result?.result?.value
if (!result || result.error) throw new Error(result?.error || 'Seeding failed')
console.log(`Worst-case board ready: ${result.cards} cards in ${result.cols} columns`)
