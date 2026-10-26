// Board stats panel: tiles, an 8-week throughput chart and per-column and
// per-member breakdowns. Hand-rolled SVG; every number also shows as text.
import { escape, formatDuration } from './util.js'

const tile = (value, label, tone = '') =>
  `<div class="stat-tile${tone ? ` ${tone}` : ''}"><span class="stat-value">${escape(String(value))}</span><span class="stat-label">${escape(label)}</span></div>`

const weekLabel = (start) =>
  new Date(start).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })

// Gridline step of 1, 2 or 5 × a power of ten, about five lines high, never
// below 1 since cards come whole.
function niceStep(max) {
  const raw = max / 5
  const power = 10 ** Math.floor(Math.log10(Math.max(raw, 1)))
  const step = [1, 2, 5, 10].map((m) => m * power).find((value) => value >= raw)
  return Math.max(1, step)
}

// Done (accent) and created (muted) per week, side by side on one axis.
function throughputChart(weeks) {
  const width = 560
  const height = 170
  const top = 12
  const bottom = 22
  const plot = height - top - bottom
  const max = Math.max(1, ...weeks.flatMap((week) => [week.done, week.created]))
  const step = niceStep(max)
  const ceiling = Math.ceil(max / step) * step
  // Room for the widest tick label.
  const left = 8 + 7 * String(ceiling).length
  const band = (width - left) / weeks.length
  const bar = Math.min(16, (band - 10) / 2)
  const y = (value) => top + plot - (value / ceiling) * plot
  // Rounded data end, square at the baseline.
  const column = (x, value, className, label) => {
    if (!value) return ''
    const h = Math.max(2, (value / ceiling) * plot)
    const r = Math.min(4, bar / 2, h)
    const y0 = top + plot
    return `<path class="${className}" d="M${x},${y0} V${y0 - h + r} q0,-${r} ${r},-${r} h${bar - 2 * r} q${r},0 ${r},${r} V${y0} z"><title>${escape(label)}</title></path>`
  }
  let grid = ''
  for (let value = 0; value <= ceiling; value += step) {
    grid += `<line class="chart-grid" x1="${left}" x2="${width}" y1="${y(value)}" y2="${y(value)}"/><text class="chart-tick" x="${left - 6}" y="${y(value) + 4}" text-anchor="end">${value}</text>`
  }
  const bars = weeks
    .map((week, index) => {
      const x = left + index * band + (band - bar * 2 - 2) / 2
      const name = `Week of ${weekLabel(week.start)}`
      return (
        // A transparent hit area per week so the tooltip doesn't need pixel aim.
        `<rect class="chart-hit" x="${left + index * band}" y="${top}" width="${band}" height="${plot}"><title>${escape(`${name}: ${week.done} done, ${week.created} created${week.points ? `, ${week.points} points` : ''}`)}</title></rect>` +
        column(x, week.created, 'chart-created', `${name}: ${week.created} created`) +
        column(x + bar + 2, week.done, 'chart-done', `${name}: ${week.done} done`) +
        (index % 2 === weeks.length % 2
          ? ''
          : `<text class="chart-tick" x="${left + index * band + band / 2}" y="${height - 6}" text-anchor="middle">${escape(weekLabel(week.start))}</text>`)
      )
    })
    .join('')
  return `<svg class="throughput-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Cards done and created per week, last ${weeks.length} weeks">${grid}${bars}</svg>`
}

export function renderStats(stats, { avatar, memberName }) {
  const { totals, cycleTime, weeks, columns, members } = stats
  const doneTotal = weeks.reduce((sum, week) => sum + week.done, 0)
  const tiles = [
    tile(totals.open, 'Open'),
    tile(totals.done, 'Done'),
    tile(totals.overdue, 'Overdue', totals.overdue ? 'warn' : ''),
    tile(totals.blocked, 'Blocked', totals.blocked ? 'warn' : ''),
    tile(`${totals.pointsDone}/${totals.pointsOpen + totals.pointsDone}`, 'Points done')
  ].join('')

  // Bars scale to the fullest column; a limit beyond that has no marker.
  const maxColumn = Math.max(1, ...columns.map((column) => column.count))
  const columnRows = columns
    .map((column) => {
      const over = column.wipLimit && column.count > column.wipLimit
      const limit =
        column.wipLimit && column.wipLimit <= maxColumn
          ? `<i class="wip-mark" style="left: ${(column.wipLimit / maxColumn) * 100}%" title="WIP limit ${column.wipLimit}"></i>`
          : ''
      return `<div class="hbar-row"><span class="hbar-name" dir="auto" title="${escape(column.name)}">${escape(column.name)}</span><span class="hbar-track"><span class="hbar-fill${over ? ' over' : ''}" style="width: ${(column.count / maxColumn) * 100}%"></span>${limit}</span><span class="hbar-value">${column.count}${column.wipLimit ? `/${column.wipLimit}` : ''}${column.points ? ` · ${column.points} pts` : ''}</span></div>`
    })
    .join('')

  const memberRows = members.length
    ? `<table class="stats-table"><thead><tr><th scope="col">Member</th><th scope="col">Open</th><th scope="col">Done this week</th></tr></thead><tbody>${[
        ...members
      ]
        .sort((a, b) => b.open + b.doneThisWeek - (a.open + a.doneThisWeek))
        .map(
          (member) =>
            `<tr><td><span class="identity" dir="auto">${avatar(member.identity)}<span class="name">${escape(member.name || memberName(member.identity))}</span></span></td><td>${member.open}</td><td>${member.doneThisWeek}</td></tr>`
        )
        .join('')}</tbody></table>`
    : '<p class="muted hint">Assign cards to people to see who is working on what.</p>'

  return `<div class="stat-tiles">${tiles}</div>
    <section class="stack">
      <div class="row card-detail-bar"><h3 class="section-label">Throughput · last ${weeks.length} weeks</h3>
        <span class="chart-legend"><span><i class="swatch-dot done"></i>Done</span><span><i class="swatch-dot created"></i>Created</span></span></div>
      ${doneTotal || weeks.some((week) => week.created) ? throughputChart(weeks) : '<p class="muted hint">Nothing created or finished in the last weeks yet.</p>'}
    </section>
    <section class="stat-tiles two">
      ${tile(formatDuration(cycleTime.median), 'Median cycle time')}
      ${tile(formatDuration(cycleTime.p85), '85% finish within')}
      <p class="muted hint">From creation to the last move into the final column, over ${cycleTime.count} finished ${cycleTime.count === 1 ? 'card' : 'cards'}.</p>
    </section>
    <section class="stack"><h3 class="section-label">Cards per column</h3><div class="hbars">${columnRows}</div></section>
    <section class="stack"><h3 class="section-label">People</h3>${memberRows}</section>`
}
