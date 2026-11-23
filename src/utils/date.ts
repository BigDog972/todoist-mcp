/**
 * Format a Date using UTC calendar components (YYYY-MM-DD).
 */
export function formatUtcDate(date: Date): string {
    const year = date.getUTCFullYear()
    const month = String(date.getUTCMonth() + 1).padStart(2, '0')
    const day = String(date.getUTCDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
}

/**
 * Parse a GMT offset string (+HH:MM or -HH:MM) to total minutes.
 * Falls back to 0 for malformed offsets.
 */
export function parseGmtOffsetToMinutes(gmtOffset: string): number {
    const match = /^([+-])(\d{2}):(\d{2})$/.exec(gmtOffset)
    if (!match) {
        return 0
    }

    const [, sign, hours, minutes] = match
    const totalMinutes = Number(hours) * 60 + Number(minutes)
    return sign === '-' ? -totalMinutes : totalMinutes
}

/**
 * Return the date string (YYYY-MM-DD) in a provided GMT offset.
 */
export function getDateInOffset(date: Date, offsetMinutes: number): string {
    const shiftedDate = new Date(date.getTime() + offsetMinutes * 60 * 1000)
    return formatUtcDate(shiftedDate)
}

/**
 * Shift a YYYY-MM-DD date string by the specified number of days in UTC.
 */
export function shiftDateStringByDays(dateString: string, days: number): string {
    const [yearPart, monthPart, dayPart] = dateString.split('-')
    const year = Number(yearPart)
    const month = Number(monthPart)
    const day = Number(dayPart)

    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
        throw new Error(`Invalid date format: ${dateString}. Expected YYYY-MM-DD.`)
    }

    const date = new Date(Date.UTC(year, month - 1, day))
    date.setUTCDate(date.getUTCDate() + days)
    return formatUtcDate(date)
}

/**
 * Format a number of minutes east of UTC as a GMT offset string (+HH:MM or -HH:MM).
 */
function formatGmtOffset(offsetMinutes: number): string {
    const sign = offsetMinutes < 0 ? '-' : '+'
    const total = Math.abs(offsetMinutes)
    const hours = String(Math.floor(total / 60)).padStart(2, '0')
    const minutes = String(total % 60).padStart(2, '0')
    return `${sign}${hours}:${minutes}`
}

/**
 * Minutes east of UTC that `timeZone` observes at `instant`, or undefined when the
 * runtime does not know the zone.
 */
function getZoneOffsetMinutes(instant: number, timeZone: string): number | undefined {
    try {
        const zoneName = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'longOffset' })
            .formatToParts(instant)
            .find((part) => part.type === 'timeZoneName')?.value
        if (zoneName === undefined) return undefined
        // "GMT" alone means UTC; otherwise "GMT+05:30" or "GMT-06:00"
        return zoneName === 'GMT' ? 0 : parseGmtOffsetToMinutes(zoneName.slice(3))
    } catch {
        return undefined
    }
}

/**
 * The GMT offset (+HH:MM or -HH:MM) that a wall-clock time on a YYYY-MM-DD date has in
 * `timeZone`. A fixed offset such as the user's current `gmtString` is wrong for dates on
 * the other side of a daylight-saving change, so ranges in the past or future use this.
 * Falls back to `fallbackOffset` when the zone is missing or unknown.
 */
export function getGmtOffsetOnDate({
    date,
    time = '00:00:00',
    timeZone,
    fallbackOffset,
}: {
    date: string
    time?: string
    timeZone: string | null | undefined
    fallbackOffset: string
}): string {
    if (!timeZone) return fallbackOffset
    const wallClockAsUtc = Date.parse(`${date}T${time}Z`)
    if (Number.isNaN(wallClockAsUtc)) return fallbackOffset

    // The offset depends on the instant, which depends on the offset: start from the
    // fallback and refine. Two rounds settle it, including on the day of a change.
    let offsetMinutes = parseGmtOffsetToMinutes(fallbackOffset)
    for (let round = 0; round < 2; round++) {
        const zoneOffset = getZoneOffsetMinutes(wallClockAsUtc - offsetMinutes * 60_000, timeZone)
        if (zoneOffset === undefined) return fallbackOffset
        offsetMinutes = zoneOffset
    }
    return formatGmtOffset(offsetMinutes)
}
