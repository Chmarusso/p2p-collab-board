// Renders the phone mockups (index.html) into landing-page screenshots and clips.
// Needs Playwright, cwebp and ffmpeg. Playwright isn't a repo dependency: copy this
// file next to a node_modules that has it and set MOCK_DIR to this folder.
//
//   node apps/landing/src/mock/render.mjs [shots|clips]
//
// Screenshots: assets/screens/<scene>-<lang>.webp (780 wide), -390.webp and -200.webp;
// the desktop scene is 1600 wide with an -800.webp variant.
// Clips: assets/clips/<scene>-<lang>.mp4 (H.264 plays everywhere) plus a .webp poster. Every
// animation is paused and set to the frame's time, so clips are smooth.
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { chromium } from 'playwright'

// Run from a folder where playwright is installed by pointing MOCK_DIR here.
const here = process.env.MOCK_DIR || import.meta.dirname
const landing = path.join(here, '..', '..')
const page = pathToFileURL(path.join(here, 'index.html')).href
const only = process.argv[2]
const LANGS = ['en', 'pl']
const SHOTS = [
  ['feed', ''],
  ['slides', 'slide=0'],
  ['chores', ''],
  ['game', 'x=302'],
  ['app', ''],
  ['chat', '']
]
const CLIPS = ['agent', 'slides', 'chores', 'game']
const FPS = 30

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2
})
const tab = await context.newPage()
const open = async (query) => {
  await tab.goto(`${page}?${query}`)
  await tab.waitForSelector('html[data-ready]')
  await tab.evaluate(() =>
    Promise.all([...document.images].map((img) => img.decode().catch(() => {})))
  )
}
const webp = (png, out, width) =>
  execFileSync('cwebp', ['-quiet', '-q', '82', '-resize', String(width), '0', png, '-o', out])

const screens = path.join(landing, 'assets/screens')
const clips = path.join(landing, 'assets/clips')
fs.mkdirSync(clips, { recursive: true })
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'opencollab-mock-'))

if (only !== 'clips') {
  const desk = await context
    .browser()
    .newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1 })
  for (const lang of LANGS) {
    await desk.goto(`${page}?scene=desktop&lang=${lang}`)
    await desk.waitForSelector('html[data-ready]')
    await desk.evaluate(() =>
      Promise.all([...document.images].map((img) => img.decode().catch(() => {})))
    )
    const png = path.join(tmp, `desktop-${lang}.png`)
    await desk.screenshot({ path: png })
    webp(png, path.join(screens, `desktop-${lang}.webp`), 1600)
    webp(png, path.join(screens, `desktop-${lang}-800.webp`), 800)
    console.log(`shot desktop-${lang}`)
  }
  await desk.close()
  for (const lang of LANGS) {
    for (const [scene, extra] of SHOTS) {
      await open(`scene=${scene}&lang=${lang}&${extra}`)
      const png = path.join(tmp, `${scene}-${lang}.png`)
      await tab.screenshot({ path: png })
      webp(png, path.join(screens, `${scene}-${lang}.webp`), 780)
      webp(png, path.join(screens, `${scene}-${lang}-390.webp`), 390)
      webp(png, path.join(screens, `${scene}-${lang}-200.webp`), 200)
      console.log(`shot ${scene}-${lang}`)
    }
  }
}

if (only !== 'shots') {
  for (const lang of LANGS) {
    for (const scene of CLIPS) {
      await open(`scene=${scene}&lang=${lang}&anim=1`)
      const duration = await tab.evaluate(() => window.sceneDuration)
      const dir = fs.mkdtempSync(path.join(tmp, `${scene}-${lang}-`))
      const frames = Math.round((duration / 1000) * FPS)
      for (let i = 0; i <= frames; i++) {
        const t = (i * 1000) / FPS
        await tab.evaluate((time) => {
          for (const a of document.getAnimations()) a.currentTime = time
        }, t)
        await tab.screenshot({ path: path.join(dir, `${String(i).padStart(4, '0')}.png`) })
      }
      const base = path.join(clips, `${scene}-${lang}`)
      const input = [
        '-y',
        '-loglevel',
        'error',
        '-framerate',
        String(FPS),
        '-i',
        path.join(dir, '%04d.png'),
        '-vf',
        'scale=540:-2'
      ]
      execFileSync('ffmpeg', [
        ...input,
        '-c:v',
        'libx264',
        '-pix_fmt',
        'yuv420p',
        '-crf',
        '24',
        '-preset',
        'slow',
        '-movflags',
        '+faststart',
        '-an',
        `${base}.mp4`
      ])
      webp(path.join(dir, `${String(frames).padStart(4, '0')}.png`), `${base}.webp`, 540)
      console.log(`clip ${scene}-${lang} · ${(duration / 1000).toFixed(1)} s · ${frames} frames`)
    }
  }
}

await browser.close()
fs.rmSync(tmp, { recursive: true, force: true })
