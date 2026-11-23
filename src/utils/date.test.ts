import { getStartOfDay } from './date.js'

describe('getStartOfDay', () => {
    it.each([
        { name: 'summer in Chicago', date: '2026-07-04', expected: '2026-07-04T00:00:00-05:00' },
        { name: 'winter in Chicago', date: '2026-01-15', expected: '2026-01-15T00:00:00-06:00' },
        {
            name: 'the day daylight saving begins',
            date: '2026-03-08',
            expected: '2026-03-08T00:00:00-06:00',
        },
        {
            name: 'the day daylight saving ends',
            date: '2026-11-01',
            expected: '2026-11-01T00:00:00-05:00',
        },
    ])('gives the start of $name', ({ date, expected }) => {
        expect(getStartOfDay({ date, timeZone: 'America/Chicago', fallbackOffset: '-06:00' })).toBe(
            expected,
        )
    })

    it.each([
        // Cairo jumps from 00:00 to 01:00, so the day starts at 01:00 +03:00, which is
        // midnight at +02:00.
        {
            timeZone: 'Africa/Cairo',
            date: '2026-04-24',
            currentOffsets: ['+03:00', '+02:00'],
            expected: '2026-04-24T00:00:00+02:00',
        },
        {
            timeZone: 'America/Santiago',
            date: '2026-09-06',
            currentOffsets: ['-03:00', '-04:00'],
            expected: '2026-09-06T00:00:00-04:00',
        },
    ])(
        'starts the day at the jump when $timeZone skips midnight, whatever the current offset',
        ({ timeZone, date, currentOffsets, expected }) => {
            for (const fallbackOffset of currentOffsets) {
                expect(getStartOfDay({ date, timeZone, fallbackOffset })).toBe(expected)
            }
        },
    )

    it('starts the day at the first midnight when midnight happens twice', () => {
        // The Azores go back from 01:00 to 00:00 on 2026-10-25.
        for (const fallbackOffset of ['+00:00', '-01:00']) {
            expect(
                getStartOfDay({ date: '2026-10-25', timeZone: 'Atlantic/Azores', fallbackOffset }),
            ).toBe('2026-10-25T00:00:00+00:00')
        }
    })

    it.each([
        { timeZone: 'Asia/Kolkata', expected: '2026-01-15T00:00:00+05:30' },
        { timeZone: 'Asia/Kathmandu', expected: '2026-01-15T00:00:00+05:45' },
        { timeZone: 'UTC', expected: '2026-01-15T00:00:00+00:00' },
        { timeZone: 'Australia/Sydney', expected: '2026-01-15T00:00:00+11:00' },
    ])('formats the offset of $timeZone', ({ timeZone, expected }) => {
        expect(getStartOfDay({ date: '2026-01-15', timeZone, fallbackOffset: '+00:00' })).toBe(
            expected,
        )
    })

    it.each([
        { name: 'no time zone', timeZone: undefined },
        { name: 'a null time zone', timeZone: null },
        { name: 'an unknown time zone', timeZone: 'Not/AZone' },
    ])('falls back to the given offset with $name', ({ timeZone }) => {
        expect(getStartOfDay({ date: '2026-07-04', timeZone, fallbackOffset: '+02:00' })).toBe(
            '2026-07-04T00:00:00+02:00',
        )
    })
})
