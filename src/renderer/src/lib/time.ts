import { strings } from '../strings'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  const day = String(date.getDate()).padStart(2, '0')
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${day}.${month}.${date.getFullYear()}`
}

export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const elapsed = Math.max(0, now - timestamp)
  if (elapsed < MINUTE) return strings.time.now
  if (elapsed < HOUR) return strings.time.minutes(Math.floor(elapsed / MINUTE))
  if (elapsed < DAY && startOfDay(now) <= timestamp) return strings.time.hours(Math.floor(elapsed / HOUR))

  const calendarDays = Math.round((startOfDay(now) - startOfDay(timestamp)) / DAY)
  if (calendarDays <= 1) return strings.time.yesterday
  if (calendarDays < 7) return strings.time.days(calendarDays)
  return formatDate(timestamp)
}
