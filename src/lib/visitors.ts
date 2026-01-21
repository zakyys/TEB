import { getFromLS, saveToLS, LS_KEYS } from '@/lib/utils'

export interface VisitorLog {
  ts: number
  date: string // YYYY-MM-DD
}

export interface VisitorLostLog {
  ts: number
  date: string
  description: string
}

const toDate = (d?: Date) => (d ?? new Date()).toISOString().split('T')[0]

export function addVisitor(d?: Date) {
  const log = getFromLS<VisitorLog[]>(LS_KEYS.VISITORS_LOG, [])
  const entry: VisitorLog = { ts: Date.now(), date: toDate(d) }
  log.push(entry)
  saveToLS(LS_KEYS.VISITORS_LOG, log)
}

export function addVisitorLost(description: string, d?: Date) {
  if (!description || description.trim() === '') {
    throw new Error('Deskripsi wajib diisi')
  }
  const log = getFromLS<VisitorLostLog[]>(LS_KEYS.VISITOR_LOST_LOG, [])
  const entry: VisitorLostLog = { ts: Date.now(), date: toDate(d), description: description.trim() }
  log.push(entry)
  saveToLS(LS_KEYS.VISITOR_LOST_LOG, log)
}

export function getVisitorStatsByDate(date: string) {
  const v = getFromLS<VisitorLog[]>(LS_KEYS.VISITORS_LOG, [])
  const l = getFromLS<VisitorLostLog[]>(LS_KEYS.VISITOR_LOST_LOG, [])
  return {
    visitors: v.filter(e => e.date === date).length,
    lost: l.filter(e => e.date === date).length,
  }
}

// Get visitor counts split by time (before and after 12:00)
export function getVisitorStatsByTime(date: string) {
  const v = getFromLS<VisitorLog[]>(LS_KEYS.VISITORS_LOG, [])
  const todayVisitors = v.filter(e => e.date === date)

  let before12 = 0
  let after12 = 0

  todayVisitors.forEach(entry => {
    const hour = new Date(entry.ts).getHours()
    if (hour < 12) {
      before12++
    } else {
      after12++
    }
  })

  return { before12, after12 }
}

// Add visitor with specific time period (manual)
export function addVisitorBefore12(d?: Date) {
  const log = getFromLS<VisitorLog[]>(LS_KEYS.VISITORS_LOG, [])
  // Use unique timestamp with hour set to 10 AM for categorization
  const date = d ?? new Date()
  const baseTs = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 10, 0, 0).getTime()
  // Add milliseconds offset to make each entry unique
  const ts = baseTs + log.filter(e => e.date === toDate(d) && new Date(e.ts).getHours() < 12).length
  const entry: VisitorLog = { ts, date: toDate(d) }
  log.push(entry)
  saveToLS(LS_KEYS.VISITORS_LOG, log)
}

export function addVisitorAfter12(d?: Date) {
  const log = getFromLS<VisitorLog[]>(LS_KEYS.VISITORS_LOG, [])
  // Use unique timestamp with hour set to 2 PM for categorization
  const date = d ?? new Date()
  const baseTs = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 14, 0, 0).getTime()
  // Add milliseconds offset to make each entry unique
  const ts = baseTs + log.filter(e => e.date === toDate(d) && new Date(e.ts).getHours() >= 12).length
  const entry: VisitorLog = { ts, date: toDate(d) }
  log.push(entry)
  saveToLS(LS_KEYS.VISITORS_LOG, log)
}

export function removeVisitorBefore12(date: string): boolean {
  const log = getFromLS<VisitorLog[]>(LS_KEYS.VISITORS_LOG, [])
  const before12Entries = log.filter(e => {
    if (e.date !== date) return false
    const hour = new Date(e.ts).getHours()
    return hour < 12
  })
  if (before12Entries.length === 0) return false

  const lastEntry = before12Entries[before12Entries.length - 1]
  const newLog = log.filter(e => e.ts !== lastEntry.ts)
  saveToLS(LS_KEYS.VISITORS_LOG, newLog)
  return true
}

export function removeVisitorAfter12(date: string): boolean {
  const log = getFromLS<VisitorLog[]>(LS_KEYS.VISITORS_LOG, [])
  const after12Entries = log.filter(e => {
    if (e.date !== date) return false
    const hour = new Date(e.ts).getHours()
    return hour >= 12
  })
  if (after12Entries.length === 0) return false

  const lastEntry = after12Entries[after12Entries.length - 1]
  const newLog = log.filter(e => e.ts !== lastEntry.ts)
  saveToLS(LS_KEYS.VISITORS_LOG, newLog)
  return true
}

export function getLostDescriptionsByDate(date: string): string[] {
  const l = getFromLS<VisitorLostLog[]>(LS_KEYS.VISITOR_LOST_LOG, [])
  return l.filter(e => e.date === date).map(e => e.description)
}

export function removeLastVisitor(date: string): boolean {
  const log = getFromLS<VisitorLog[]>(LS_KEYS.VISITORS_LOG, [])
  const todayEntries = log.filter(e => e.date === date)
  if (todayEntries.length === 0) return false

  const lastEntry = todayEntries[todayEntries.length - 1]
  const newLog = log.filter(e => e.ts !== lastEntry.ts)
  saveToLS(LS_KEYS.VISITORS_LOG, newLog)
  return true
}

export function removeLastLost(date: string): boolean {
  const log = getFromLS<VisitorLostLog[]>(LS_KEYS.VISITOR_LOST_LOG, [])
  const todayEntries = log.filter(e => e.date === date)
  if (todayEntries.length === 0) return false

  const lastEntry = todayEntries[todayEntries.length - 1]
  const newLog = log.filter(e => e.ts !== lastEntry.ts)
  saveToLS(LS_KEYS.VISITOR_LOST_LOG, newLog)
  return true
}

export function getLostEntriesByDate(date: string): VisitorLostLog[] {
  const l = getFromLS<VisitorLostLog[]>(LS_KEYS.VISITOR_LOST_LOG, [])
  return l.filter(e => e.date === date)
}

export function removeLostByTimestamp(ts: number): boolean {
  const log = getFromLS<VisitorLostLog[]>(LS_KEYS.VISITOR_LOST_LOG, [])
  const newLog = log.filter(e => e.ts !== ts)
  if (newLog.length === log.length) return false
  saveToLS(LS_KEYS.VISITOR_LOST_LOG, newLog)
  return true
}

export function updateLostDescription(ts: number, newDescription: string): boolean {
  if (!newDescription || newDescription.trim() === '') return false
  const log = getFromLS<VisitorLostLog[]>(LS_KEYS.VISITOR_LOST_LOG, [])
  const entry = log.find(e => e.ts === ts)
  if (!entry) return false
  entry.description = newDescription.trim()
  saveToLS(LS_KEYS.VISITOR_LOST_LOG, log)
  return true
}

export function getVisitorMaps() {
  const v = getFromLS<VisitorLog[]>(LS_KEYS.VISITORS_LOG, [])
  const l = getFromLS<VisitorLostLog[]>(LS_KEYS.VISITOR_LOST_LOG, [])
  const visitorsByDate: Record<string, number> = {}
  const lostByDate: Record<string, number> = {}
  v.forEach(e => { visitorsByDate[e.date] = (visitorsByDate[e.date] || 0) + 1 })
  l.forEach(e => { lostByDate[e.date] = (lostByDate[e.date] || 0) + 1 })
  return { visitorsByDate, lostByDate }
}


export function getDailyStatsInRange(start?: string, end?: string) {
  const { visitorsByDate, lostByDate } = getVisitorMaps()
  const dates = new Set<string>([
    ...Object.keys(visitorsByDate),
    ...Object.keys(lostByDate),
  ])
  const inRange = (d: string) => {
    if (start && d < start) return false
    if (end && d > end) return false
    return true
  }
  const rows = Array.from(dates)
    .filter(inRange)
    .sort()
    .map(date => ({
      date,
      visitors: visitorsByDate[date] || 0,
      lost: lostByDate[date] || 0,
    }))
  return rows
}