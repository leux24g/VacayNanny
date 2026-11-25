/** Calendar dates stay in local calendar coordinates; never convert them to UTC. */
export function calendarDate(value?: string): Date | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value.slice(0, 10))) return undefined
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const date = new Date(0)
  date.setHours(12, 0, 0, 0)
  date.setFullYear(year, month - 1, day)
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date : undefined
}

export function calendarValue(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

export function dateValueAllowed(value: string, min?: string, max?: string): boolean {
  if (!calendarDate(value)) return false
  const timed = value.length > 10
  if (timed && !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) return false
  const comparable = (v: string, upper = false) => !timed ? v.slice(0, 10)
    : v.length === 10 ? `${v}T${upper ? '23:59:59' : '00:00:00'}`
      : v.length === 16 ? `${v}:00` : v
  return (!min || comparable(value) >= comparable(min)) && (!max || comparable(value) <= comparable(max, true))
}

/** Match the existing application validator's 21-year cutoff. */
export function birthDateLimit(now = new Date()): string {
  const cutoff = new Date(now)
  cutoff.setUTCFullYear(cutoff.getUTCFullYear() - 21)
  return cutoff.toISOString().slice(0, 10)
}
