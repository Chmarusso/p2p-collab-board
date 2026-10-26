// Mirrors packages/board-protocol/themes.js (the renderer loads plain ES modules
// and cannot require it); scripts/test-themes.mjs checks the copies match.
//
// Board theme templates: a curated palette per template, in a dark and a light
// variant. The board stores only the template id (`board:theme`); each device
// picks dark or light itself and may override the template locally.

const DEFAULT_TEMPLATE = 'terminal'

// Status colours shared by every template, tuned per mode.
const STATUS = Object.freeze({
  dark: {
    info: '#22d3ee',
    magenta: '#ff4fd8',
    error: '#ff5c5c',
    danger: '#f87168',
    warn: '#f5cd47',
    success: '#4bce97'
  },
  light: {
    info: '#0e7490',
    magenta: '#a21caf',
    error: '#c62828',
    danger: '#b42318',
    warn: '#8a5a00',
    success: '#1f845a'
  }
})

const palette = (mode, colors) => Object.freeze({ ...colors, ...STATUS[mode] })

const THEME_TEMPLATES = Object.freeze([
  {
    id: 'terminal',
    name: 'Terminal',
    dark: palette('dark', {
      bg: '#0a0e14',
      surface: '#0f1620',
      surfaceRaised: '#141d29',
      border: '#1c2633',
      text: '#c9d4e3',
      muted: '#7d8ca3',
      accent: '#39ff88',
      accentInk: '#04110a'
    }),
    light: palette('light', {
      bg: '#f4f7f5',
      surface: '#ffffff',
      surfaceRaised: '#eaf0ec',
      border: '#d3ddd7',
      text: '#0f1a14',
      muted: '#55635b',
      accent: '#0a7a3d',
      accentInk: '#ffffff'
    })
  },
  {
    id: 'ocean',
    name: 'Ocean',
    dark: palette('dark', {
      bg: '#07111c',
      surface: '#0c1826',
      surfaceRaised: '#112031',
      border: '#1b2d42',
      text: '#d0e1f2',
      muted: '#7f97b0',
      accent: '#38bdf8',
      accentInk: '#031018'
    }),
    light: palette('light', {
      bg: '#f2f6fb',
      surface: '#ffffff',
      surfaceRaised: '#e7eef7',
      border: '#cfdbe8',
      text: '#0b1a2a',
      muted: '#51667b',
      accent: '#0369a1',
      accentInk: '#ffffff'
    })
  },
  {
    id: 'nebula',
    name: 'Nebula',
    dark: palette('dark', {
      bg: '#0d0b16',
      surface: '#141022',
      surfaceRaised: '#1b1630',
      border: '#2a2343',
      text: '#ded7f4',
      muted: '#9187b3',
      accent: '#a78bfa',
      accentInk: '#120a24'
    }),
    light: palette('light', {
      bg: '#f7f5fc',
      surface: '#ffffff',
      surfaceRaised: '#eee9f9',
      border: '#ddd5f0',
      text: '#1b1430',
      muted: '#605879',
      accent: '#6d28d9',
      accentInk: '#ffffff'
    })
  },
  {
    id: 'ember',
    name: 'Ember',
    dark: palette('dark', {
      bg: '#120c09',
      surface: '#1a120d',
      surfaceRaised: '#241913',
      border: '#36261c',
      text: '#f0e0d4',
      muted: '#a48d7e',
      accent: '#fb923c',
      accentInk: '#1a0a02'
    }),
    light: palette('light', {
      bg: '#fcf7f3',
      surface: '#ffffff',
      surfaceRaised: '#f6ede6',
      border: '#e9d8ca',
      text: '#2a1a10',
      muted: '#73604f',
      accent: '#b93d0a',
      accentInk: '#ffffff'
    })
  },
  {
    id: 'rose',
    name: 'Rose',
    dark: palette('dark', {
      bg: '#140a10',
      surface: '#1c0f17',
      surfaceRaised: '#27141f',
      border: '#3b2031',
      text: '#f3dce8',
      muted: '#a88798',
      accent: '#f472b6',
      accentInk: '#22040f'
    }),
    light: palette('light', {
      bg: '#fcf5f8',
      surface: '#ffffff',
      surfaceRaised: '#f7eaf0',
      border: '#eed2df',
      text: '#2a0f1d',
      muted: '#785464',
      accent: '#be185d',
      accentInk: '#ffffff'
    })
  },
  {
    id: 'graphite',
    name: 'Graphite',
    dark: palette('dark', {
      bg: '#0e0f11',
      surface: '#16181b',
      surfaceRaised: '#1e2125',
      border: '#2b2f34',
      text: '#dadde2',
      muted: '#878e97',
      accent: '#e5e7eb',
      accentInk: '#111214'
    }),
    light: palette('light', {
      bg: '#f5f6f7',
      surface: '#ffffff',
      surfaceRaised: '#eceef0',
      border: '#d8dce0',
      text: '#111418',
      muted: '#59616a',
      accent: '#1f2937',
      accentInk: '#ffffff'
    })
  }
])

const THEME_MODES = Object.freeze(['system', 'light', 'dark'])

const isTemplateId = (value) => typeof value === 'string' && /^[a-z0-9-]{1,32}$/.test(value)

// Unknown ids (a template added by a newer client) fall back to the default.
function themeTemplate(id) {
  const find = (key) => THEME_TEMPLATES.find((template) => template.id === key)
  return find(id) || find(DEFAULT_TEMPLATE)
}

export { DEFAULT_TEMPLATE, THEME_TEMPLATES, THEME_MODES, isTemplateId, themeTemplate }
