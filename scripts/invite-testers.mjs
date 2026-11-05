#!/usr/bin/env node
// Invite people to the Android closed test on Google Play.
//
//   node scripts/invite-testers.mjs ann@example.com bob@example.com
//   node scripts/invite-testers.mjs --file friends.txt --lang pl
//   node scripts/invite-testers.mjs --list
//
// Google offers no API for a closed test's email list, so the test's testers
// are a Google Group (Play Console → Test and release → Closed testing →
// Testers). This script:
//   1. prints the new addresses comma-separated, to paste into the group's
//      Members → Invite members (Google then emails each an invitation);
//   2. opens one email draft to all of them (Bcc) in your mail app, or in Gmail
//      with --gmail, pointing at the beta page that walks them through joining;
//   3. remembers who was invited in ~/.opencollab-testers.json (outside the
//      repo: addresses are personal data), so nobody is invited twice.
//
// Options: --file <path> (addresses separated by lines, commas or spaces),
// --lang en|pl, --gmail, --print (show the message, open nothing),
// --again (include addresses invited before), --dry-run (record nothing),
// --list (who was invited, and when).
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'

const SITE = process.env.LANDING_URL || 'https://chmarusso.github.io/p2p-collab-board/'
const LOG = process.env.OPENCOLLAB_TESTERS || path.join(os.homedir(), '.opencollab-testers.json')
const NEEDED = 12

const args = process.argv.slice(2)
const flag = (name) => {
  const at = args.indexOf(name)
  if (at === -1) return false
  args.splice(at, 1)
  return true
}
const option = (name) => {
  const at = args.indexOf(name)
  if (at === -1) return null
  const [, value] = args.splice(at, 2)
  if (!value) throw new Error(`${name} needs a value`)
  return value
}

const messages = {
  en: {
    subject: 'Help me test OpenCollab on Android',
    body: (url) => `Hi,

I'm building OpenCollab, a private board app for friends and groups: no account, end-to-end encrypted, no server. It's in closed testing on Google Play, and Google needs 12 testers who keep it installed for 14 days before it can go public.

Would you join? It takes two minutes:
${url}

1. Join the testers group with the Google account on your phone.
2. Open the testing page and press "Become a tester".
3. Install OpenCollab from Google Play and keep it for two weeks.

Thank you!`
  },
  pl: {
    subject: 'Pomożesz mi przetestować OpenCollab na Androidzie?',
    body: (url) => `Cześć,

robię OpenCollab, aplikację z prywatnymi tablicami dla znajomych i grup: bez konta, szyfrowanie end-to-end, bez serwera. Jest w zamkniętych testach w Google Play, a Google wymaga 12 testerów, którzy będą ją mieć przez 14 dni, zanim wypuści ją publicznie.

Dołączysz? Zajmie ci to dwie minuty:
${url}

1. Dołącz do grupy testerów kontem Google, którego używasz na telefonie.
2. Otwórz stronę testów i naciśnij „Zostań testerem”.
3. Zainstaluj OpenCollab z Google Play i zostaw go na dwa tygodnie.

Dzięki!`
  }
}

function readLog() {
  try {
    return JSON.parse(fs.readFileSync(LOG, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw new Error(`can't read ${LOG}: ${error.message}`)
  }
}

function openUrl(url) {
  const command =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open'
  execFileSync(command, [url], { stdio: 'ignore' })
}

function main() {
  const log = readLog()
  if (flag('--list')) {
    for (const entry of log) console.log(`${entry.invitedAt.slice(0, 10)}  ${entry.email}`)
    console.log(`${log.length} invited · Google needs ${NEEDED} testers opted in for 14 days`)
    return
  }
  const lang = option('--lang') || 'en'
  if (!messages[lang]) throw new Error('--lang must be en or pl')
  const file = option('--file')
  const gmail = flag('--gmail')
  const print = flag('--print')
  const again = flag('--again')
  const dryRun = flag('--dry-run')
  const unknown = args.find((arg) => arg.startsWith('--'))
  if (unknown) throw new Error(`unknown option ${unknown}`)

  const raw = [...args, ...(file ? fs.readFileSync(file, 'utf8').split(/[\s,;]+/) : [])]
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean)
  const invalid = raw.filter((email) => !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
  if (invalid.length) throw new Error(`not an email address: ${invalid.join(', ')}`)
  const known = new Set(log.map((entry) => entry.email))
  const unique = [...new Set(raw)]
  const skipped = again ? [] : unique.filter((email) => known.has(email))
  const emails = unique.filter((email) => !skipped.includes(email))
  if (skipped.length) console.log(`already invited, skipped (use --again): ${skipped.join(', ')}`)
  if (!emails.length) {
    if (!unique.length) {
      console.log('Give addresses as arguments or with --file. --list shows who was invited.')
    }
    return
  }

  const url = `${SITE}${lang === 'pl' ? 'pl/' : ''}beta/`
  const { subject, body } = messages[lang]
  const text = body(url)
  console.log(
    `\n1. Paste into the Google Group → Members → Invite members:\n\n${emails.join(', ')}\n`
  )
  if (print) {
    console.log(`2. Send this (Bcc everyone):\n\nSubject: ${subject}\n\n${text}\n`)
  } else {
    const query = (pairs) =>
      Object.entries(pairs)
        .map(([key, value]) => `${key}=${encodeURIComponent(value)}`)
        .join('&')
    const draft = gmail
      ? `https://mail.google.com/mail/?${query({ view: 'cm', bcc: emails.join(','), su: subject, body: text })}`
      : // Commas between mailto addresses stay literal; some mail apps don't split %2C.
        `mailto:?bcc=${emails.map(encodeURIComponent).join(',')}&${query({ subject, body: text })}`
    openUrl(draft)
    console.log(
      `2. A draft to ${emails.length} address(es) is open in ${gmail ? 'Gmail' : 'your mail app'}. Check it and send.`
    )
  }
  if (dryRun) return console.log('Dry run: nothing recorded.')
  const now = new Date().toISOString()
  const next = [
    ...log.filter((entry) => !emails.includes(entry.email)),
    ...emails.map((email) => ({ email, invitedAt: now, lang }))
  ]
  fs.writeFileSync(LOG, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 })
  console.log(`Recorded in ${LOG}: ${next.length} invited so far, Google needs ${NEEDED}.`)
}

try {
  main()
} catch (error) {
  console.error(`invite-testers: ${error.message}`)
  process.exit(1)
}
