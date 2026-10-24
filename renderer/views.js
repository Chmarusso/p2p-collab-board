// The board's other views: a sortable table and a month calendar by due date.
// Both show the cards the board view would (filters, archived toggle) and
// open the same card details.
import { escape, relativeTime, isoDay } from './util.js'

export const TABLE_COLUMNS = [
  ['title', 'Title'],
  ['column', 'Column'],
  ['assignees', 'Assignees'],
  ['due', 'Due'],
  ['points', 'Points'],
  ['labels', 'Labels'],
  ['updated', 'Updated']
]

// Cards without a value sort last whichever way the column is sorted.
function sortValue(card, key, ctx) {
  switch (key) {
    case 'title':
      return card.title.toLowerCase()
    case 'column':
      return ctx.columns.findIndex((column) => column.id === card.columnId)
    case 'assignees':
      return card.assignees?.length ? ctx.memberName(card.assignees[0]).toLowerCase() : null
    case 'due':
      return ctx.dueInfo(card.dueDate)?.deadline.getTime() ?? null
    case 'points':
      return card.points ?? null
    case 'labels':
      return card.labelIds?.length
        ? ctx.labels.find((label) => label.id === card.labelIds[0])?.name.toLowerCase() || null
        : null
    case 'updated':
      return card.updatedAt || null
  }
  return null
}

export function sortCards(cards, sort, ctx) {
  const direction = sort.dir === 'desc' ? -1 : 1
  return [...cards].sort((a, b) => {
    const x = sortValue(a, sort.key, ctx)
    const y = sortValue(b, sort.key, ctx)
    if (x === null || y === null) return (x === null) - (y === null)
    return (x < y ? -1 : x > y ? 1 : 0) * direction
  })
}

export function renderTable(container, cards, ctx) {
  const sorted = sortCards(cards, ctx.sort, ctx)
  const head = TABLE_COLUMNS.map(([key, name]) => {
    const active = ctx.sort.key === key
    const sort = active ? (ctx.sort.dir === 'desc' ? 'descending' : 'ascending') : 'none'
    return `<th scope="col" aria-sort="${sort}"><button type="button" class="table-sort${active ? ' active' : ''}" data-sort="${key}">${escape(name)}<span class="sort-arrow" aria-hidden="true">${active ? (ctx.sort.dir === 'desc' ? '↓' : '↑') : ''}</span></button></th>`
  }).join('')
  const rows = sorted
    .map((card) => {
      const column = ctx.columns.find((entry) => entry.id === card.columnId)
      return `<tr class="table-row${card.archived ? ' archived' : ''}" data-card-id="${escape(card.id)}" tabindex="0">
        <td class="cell-title"><span dir="auto" title="${escape(card.title)}">${escape(card.title)}</span>${card.blockedBy?.length ? '<span class="blocked-badge">Blocked</span>' : ''}</td>
        <td><span class="column-pill" style="--column-color: ${column?.color || 'var(--border)'}" dir="auto">${escape(column?.name || '')}</span></td>
        <td>${ctx.avatarStack(card.assignees, 4) || '<span class="muted">—</span>'}</td>
        <td>${ctx.dueBadge(card) || '<span class="muted">—</span>'}</td>
        <td class="mono">${card.points ?? '<span class="muted">—</span>'}</td>
        <td><div class="label-list">${ctx.labelChips(card.labelIds, 3)}</div></td>
        <td class="time" title="${card.updatedAt ? escape(new Date(card.updatedAt).toLocaleString()) : ''}">${escape(card.updatedAt ? relativeTime(card.updatedAt) : '')}</td>
      </tr>`
    })
    .join('')
  container.innerHTML = cards.length
    ? `<div class="table-scroll"><table class="cards-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div>`
    : '<div class="view-empty">No cards match. Add a card or clear the filters.</div>'
  for (const button of container.querySelectorAll('[data-sort]')) {
    button.onclick = () => ctx.onSort(button.dataset.sort)
  }
  for (const row of container.querySelectorAll('tr[data-card-id]')) {
    row.onclick = () => ctx.openCard(row.dataset.cardId)
    row.onkeydown = (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        ctx.openCard(row.dataset.cardId)
      }
    }
  }
}

const MAX_CHIPS = 3

// Over the day it belongs to, kept inside the calendar's width.
function placePopover(container, popover, cell) {
  if (!cell) return
  const box = container.getBoundingClientRect()
  const day = cell.getBoundingClientRect()
  const width = Math.max(day.width, 240)
  popover.style.width = `${width}px`
  popover.style.left = `${Math.max(0, Math.min(day.left - box.left, box.width - width))}px`
  popover.style.top = `${day.top - box.top}px`
}

// Weeks start on Monday; the grid always shows whole weeks around the month.
export function renderCalendar(container, cards, ctx) {
  const month = new Date(ctx.month.getFullYear(), ctx.month.getMonth(), 1)
  const start = new Date(month)
  start.setDate(1 - ((month.getDay() + 6) % 7))
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 0)
  const days = []
  for (let day = new Date(start); day <= end || days.length % 7; day.setDate(day.getDate() + 1)) {
    days.push(new Date(day))
  }
  const byDay = new Map()
  let undated = 0
  for (const card of cards) {
    const due = ctx.dueInfo(card.dueDate)
    if (!due) {
      undated++
      continue
    }
    const key = isoDay(due.deadline)
    if (!byDay.has(key)) byDay.set(key, [])
    byDay.get(key).push(card)
  }
  const today = isoDay(new Date())
  const weekdays = days
    .slice(0, 7)
    .map(
      (day) =>
        `<div class="calendar-weekday">${escape(day.toLocaleDateString(undefined, { weekday: 'short' }))}</div>`
    )
    .join('')
  // The open "+N more" list sits over the grid, outside its rounded clip.
  let popover = ''
  const cells = days
    .map((day) => {
      const key = isoDay(day)
      const items = (byDay.get(key) || []).sort(
        (a, b) => ctx.dueInfo(a.dueDate).deadline - ctx.dueInfo(b.dueDate).deadline
      )
      const outside = day.getMonth() !== month.getMonth()
      const chip = (card) => {
        const label = ctx.labels.find((entry) => entry.id === card.labelIds?.[0])
        const done = ctx.isDone(card)
        return `<button type="button" class="calendar-card${done ? ' done' : ''}${card.blockedBy?.length ? ' blocked' : ''}" draggable="true" data-card-id="${escape(card.id)}" style="--label-color: ${label?.color || 'var(--muted)'}" title="${escape(card.title)}"><span dir="auto">${escape(card.title)}</span></button>`
      }
      // A busy day shows three cards and a "+N more" list of all of them.
      const shown = items.slice(0, MAX_CHIPS)
      const more =
        items.length > shown.length
          ? `<button type="button" class="ghost calendar-more" data-more-day="${key}" aria-expanded="${ctx.openDay === key}">+${items.length - shown.length} more</button>`
          : ''
      const date = day.toLocaleDateString(undefined, {
        weekday: 'long',
        month: 'long',
        day: 'numeric'
      })
      if (ctx.openDay === key) {
        popover = `<div class="calendar-popover" role="dialog" aria-label="${escape(date)}"><div class="calendar-popover-head"><span>${escape(date)}</span><button type="button" class="ghost" data-more-day="" aria-label="Close">✕</button></div>${items.map(chip).join('')}</div>`
      }
      return `<div class="calendar-day${outside ? ' outside' : ''}${key === today ? ' today' : ''}" data-day="${key}" role="group" aria-label="${escape(`${date}, ${items.length} ${items.length === 1 ? 'card' : 'cards'}`)}"><span class="calendar-date" aria-hidden="true">${day.getDate()}</span>${shown.map(chip).join('')}${more}</div>`
    })
    .join('')
  const title = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
  container.innerHTML = `<div class="calendar-head">
      <h2 class="calendar-title">${escape(title)}</h2>
      <div class="row">
        <button type="button" class="secondary icon-only" data-month="-1" aria-label="Previous month">‹</button>
        <button type="button" class="secondary" data-month="0">Today</button>
        <button type="button" class="secondary icon-only" data-month="1" aria-label="Next month">›</button>
      </div>
      <span class="muted hint">${undated ? `${undated} ${undated === 1 ? 'card has' : 'cards have'} no due date · ` : ''}Drag a card to another day to reschedule it</span>
    </div>
    <div class="calendar-grid">${weekdays}${cells}</div>${popover}`
  for (const button of container.querySelectorAll('[data-more-day]')) {
    button.onclick = () => ctx.onMoreDay(button.dataset.moreDay || null)
  }
  const list = container.querySelector('.calendar-popover')
  if (list) placePopover(container, list, container.querySelector(`[data-day="${ctx.openDay}"]`))
  if (list) {
    list.onkeydown = (event) => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      ctx.onMoreDay(null)
    }
  }
  for (const button of container.querySelectorAll('[data-month]')) {
    button.onclick = () => ctx.onMonth(Number(button.dataset.month))
  }
  let dragged = null
  for (const chip of container.querySelectorAll('.calendar-card')) {
    chip.onclick = () => ctx.openCard(chip.dataset.cardId)
    chip.ondragstart = (event) => {
      dragged = chip.dataset.cardId
      event.dataTransfer.effectAllowed = 'move'
      event.dataTransfer.setData('text/plain', dragged)
      requestAnimationFrame(() => chip.classList.add('dragging'))
      ctx.onDrag(true)
    }
    chip.ondragend = () => {
      dragged = null
      chip.classList.remove('dragging')
      for (const cell of container.querySelectorAll('.drop-target')) {
        cell.classList.remove('drop-target')
      }
      ctx.onDrag(false)
    }
  }
  for (const cell of container.querySelectorAll('.calendar-day')) {
    cell.ondragover = (event) => {
      if (!dragged) return
      event.preventDefault()
      cell.classList.add('drop-target')
    }
    cell.ondragleave = (event) => {
      if (!cell.contains(event.relatedTarget)) cell.classList.remove('drop-target')
    }
    cell.ondrop = (event) => {
      if (!dragged) return
      event.preventDefault()
      cell.classList.remove('drop-target')
      ctx.onReschedule(dragged, cell.dataset.day)
    }
  }
}
