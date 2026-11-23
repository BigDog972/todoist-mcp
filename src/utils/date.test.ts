import { getGmtOffsetOnDate } from './date.js'

describe('getGmtOffsetOnDate', () => {
    it.each([
        { name: 'summer in Chicago', date: '2026-07-04', expected: '-05:00' },
        { name: 'winter in Chicago', date: '2026-01-15', expected: '-06:00' },
        { name: 'start of the day daylight saving begins', date: '2026-03-08', expected: '-06:00' },
        { name: 'start of the day daylight saving ends', date: '2026-11-01', expected: '-05:00' },
    ])('gives the offset for $name', ({ date, expected }) => {
        expect(
            getGmtOffsetOnDate({ date, timeZone: 'America/Chicago', fallbackOffset: '-06:00' }),
        ).toBe(expected)
    })

    it('uses the offset in force at the given time on a day the offset changes', () => {
        expect(
            getGmtOffsetOnDate({
                date: '2026-03-08',
                time: '23:59:59',
                timeZone: 'America/Chicago',
                fallbackOffset: '-06:00',
            }),
        ).toBe('-05:00')
    })

    it.each([
        { timeZone: 'Asia/Kolkata', expected: '+05:30' },
        { timeZone: 'Asia/Kathmandu', expected: '+05:45' },
        { timeZone: 'UTC', expected: '+00:00' },
        { timeZone: 'Australia/Sydney', expected: '+11:00' },
    ])('formats the offset of $timeZone', ({ timeZone, expected }) => {
        expect(getGmtOffsetOnDate({ date: '2026-01-15', timeZone, fallbackOffset: '+00:00' })).toBe(
            expected,
        )
    })

    it.each([
        { name: 'no time zone', timeZone: undefined },
        { name: 'a null time zone', timeZone: null },
        { name: 'an unknown time zone', timeZone: 'Not/AZone' },
    ])('falls back to the given offset with $name', ({ timeZone }) => {
        expect(getGmtOffsetOnDate({ date: '2026-07-04', timeZone, fallbackOffset: '+02:00' })).toBe(
            '+02:00',
        )
    })
})
