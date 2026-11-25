import type { GetPromptResult } from '@modelcontextprotocol/server'
import type { TodoistApi } from '@todoist/sdk'
import { type Mocked, vi } from 'vitest'
import { createMockUser } from '../utils/test-helpers.js'
import { buildPromptText, computeDateRange, productivityAnalysis } from './productivity-analysis.js'

const mockTodoistApi = {
    getUser: vi.fn(),
} as unknown as Mocked<TodoistApi>

function userWithOffset(gmtString: string, timezone: string) {
    return createMockUser({
        tzInfo: { timezone, gmtString, hours: 0, minutes: 0, isDst: 0 },
    })
}

function getPromptText(result: GetPromptResult): string {
    // oxlint-disable-next-line no-unsafe-optional-chaining -- test helper, messages always present
    return (result.messages[0]?.content as { type: 'text'; text: string }).text
}

describe('productivity-analysis prompt', () => {
    describe('prompt metadata', () => {
        it('should have correct name and description', () => {
            expect(productivityAnalysis.name).toBe('productivity-analysis')
            expect(productivityAnalysis.title).toBe('Productivity Analysis')
            expect(productivityAnalysis.description).toContain('productivity')
        })
    })

    describe('callback', () => {
        beforeEach(() => {
            mockTodoistApi.getUser.mockResolvedValue(userWithOffset('+00:00', 'UTC'))
        })

        it('should return a valid GetPromptResult with a user message', async () => {
            const result = await productivityAnalysis.callback(
                {
                    period: '7d',
                    focus: 'overall',
                },
                mockTodoistApi,
            )

            expect(result.messages).toHaveLength(1)
            expect(result.messages[0]?.role).toBe('user')
            expect(result.messages[0]?.content.type).toBe('text')
        })

        it('should include tool instructions in the prompt text', async () => {
            const result = await productivityAnalysis.callback(
                {
                    period: '7d',
                    focus: 'overall',
                },
                mockTodoistApi,
            )

            const text = getPromptText(result)
            expect(text).toContain('user-info')
            expect(text).toContain('get-productivity-stats')
            expect(text).toContain('find-completed-tasks')
            expect(text).toContain('get-overview')
        })

        it('should include projectId scope when provided', async () => {
            const result = await productivityAnalysis.callback(
                {
                    period: '7d',
                    focus: 'overall',
                    projectId: 'proj123',
                },
                mockTodoistApi,
            )

            const text = getPromptText(result)
            expect(text).toContain('proj123')
            expect(text).toContain('Scope this analysis to project ID: proj123')
        })

        it('should not include projectId text when not provided', async () => {
            const result = await productivityAnalysis.callback(
                {
                    period: '7d',
                    focus: 'overall',
                },
                mockTodoistApi,
            )

            const text = getPromptText(result)
            expect(text).not.toContain('Scope this analysis to project ID')
        })
    })

    describe('focus areas', () => {
        it.each([
            {
                focus: 'overall' as const,
                includes: [
                    'Goal Tracking',
                    'Completion Trends',
                    'Project Distribution',
                    'Recommendations',
                ],
                excludes: [],
                includesOverview: true,
            },
            {
                focus: 'goals' as const,
                includes: ['Goal Tracking'],
                excludes: [
                    '### Completion Trends',
                    '### Project Distribution',
                    '### Recommendations',
                ],
                includesOverview: false,
            },
            {
                focus: 'projects' as const,
                includes: ['Project Distribution'],
                excludes: ['### Goal Tracking', '### Completion Trends', '### Recommendations'],
                includesOverview: true,
            },
            {
                focus: 'trends' as const,
                includes: ['Completion Trends'],
                excludes: ['### Goal Tracking', '### Project Distribution', '### Recommendations'],
                includesOverview: false,
            },
            {
                focus: 'recommendations' as const,
                includes: ['Karma & Momentum', 'Recommendations'],
                excludes: ['### Goal Tracking', '### Completion Trends'],
                includesOverview: false,
            },
        ])(
            'should include correct sections for "$focus" focus',
            ({ focus, includes, excludes, includesOverview }) => {
                const text = buildPromptText({ period: '7d', focus })

                for (const section of includes) {
                    expect(text).toContain(section)
                }
                for (const section of excludes) {
                    expect(text).not.toContain(section)
                }
                if (includesOverview) {
                    expect(text).toContain('get-overview')
                } else {
                    expect(text).not.toContain('get-overview')
                }
            },
        )
    })

    describe("dates on the user's own calendar", () => {
        beforeEach(() => {
            vi.useFakeTimers()
            vi.spyOn(console, 'error').mockImplementation(() => {})
        })

        afterEach(() => {
            vi.useRealTimers()
            vi.restoreAllMocks()
        })

        it.each([
            {
                name: 'west of UTC in the evening, when UTC is already tomorrow',
                now: '2026-11-25T02:00:00Z', // 8 PM Nov 24 in Chicago
                gmtString: '-06:00',
                timezone: 'America/Chicago',
                since: '2026-11-18',
                until: '2026-11-24',
            },
            {
                name: 'east of UTC in the morning, when UTC is still yesterday',
                now: '2026-11-24T20:00:00Z', // 9 AM Nov 25 in Auckland
                gmtString: '+13:00',
                timezone: 'Pacific/Auckland',
                since: '2026-11-19',
                until: '2026-11-25',
            },
        ])("ends the last 7 days on the user's today $name", async (scenario) => {
            vi.setSystemTime(new Date(scenario.now))
            mockTodoistApi.getUser.mockResolvedValue(
                userWithOffset(scenario.gmtString, scenario.timezone),
            )

            const text = getPromptText(
                await productivityAnalysis.callback(
                    { period: '7d', focus: 'overall' },
                    mockTodoistApi,
                ),
            )

            expect(text).toContain(`(${scenario.since} to ${scenario.until})`)
            expect(text).toContain(`since: "${scenario.since}", until: "${scenario.until}"`)
        })

        it.each([
            { startDay: 1, dayName: 'Monday', since: '2026-11-23' },
            { startDay: 7, dayName: 'Sunday', since: '2026-11-22' },
            { startDay: 6, dayName: 'Saturday', since: '2026-11-21' },
            { startDay: 3, dayName: 'Wednesday', since: '2026-11-25' },
        ])(
            "starts this week on the user's week start day, $dayName",
            async ({ startDay, dayName, since }) => {
                vi.setSystemTime(new Date('2026-11-25T12:00:00Z')) // Wednesday
                mockTodoistApi.getUser.mockResolvedValue(
                    createMockUser({ ...userWithOffset('+00:00', 'UTC'), startDay }),
                )

                const text = getPromptText(
                    await productivityAnalysis.callback(
                        { period: 'this-week', focus: 'overall' },
                        mockTodoistApi,
                    ),
                )

                expect(text).toContain(`this week (${dayName} to today) (${since} to 2026-11-25)`)
                expect(text).toContain(`since: "${since}", until: "2026-11-25"`)
            },
        )

        it('starts this week on Monday when the user cannot be loaded', async () => {
            vi.setSystemTime(new Date('2026-11-25T12:00:00Z')) // Wednesday
            mockTodoistApi.getUser.mockRejectedValue(new Error('network down'))

            const text = getPromptText(
                await productivityAnalysis.callback(
                    { period: 'this-week', focus: 'overall' },
                    mockTodoistApi,
                ),
            )

            expect(text).toContain('this week (Monday to today) (2026-11-23 to 2026-11-25)')
        })

        it("starts this week on Monday when the user's week start day is outside 1 to 7", async () => {
            vi.setSystemTime(new Date('2026-11-25T12:00:00Z')) // Wednesday
            mockTodoistApi.getUser.mockResolvedValue(
                createMockUser({ ...userWithOffset('+00:00', 'UTC'), startDay: 0 }),
            )

            const text = getPromptText(
                await productivityAnalysis.callback(
                    { period: 'this-week', focus: 'overall' },
                    mockTodoistApi,
                ),
            )

            expect(text).toContain('this week (Monday to today) (2026-11-23 to 2026-11-25)')
        })

        it('falls back to UTC dates when the user cannot be loaded', async () => {
            vi.setSystemTime(new Date('2026-11-25T02:00:00Z'))
            mockTodoistApi.getUser.mockRejectedValue(new Error('network down'))

            const text = getPromptText(
                await productivityAnalysis.callback(
                    { period: 'today', focus: 'goals' },
                    mockTodoistApi,
                ),
            )

            expect(text).toContain('(2026-11-25 to 2026-11-25)')
        })
    })

    describe('computeDateRange', () => {
        const fixedDate = new Date('2026-03-17T12:00:00Z')

        it.each([
            {
                period: 'today' as const,
                date: fixedDate,
                since: '2026-03-17',
                until: '2026-03-17',
                descriptionContains: 'today',
            },
            {
                period: '7d' as const,
                date: fixedDate,
                since: '2026-03-11',
                until: '2026-03-17',
                descriptionContains: '7 days',
            },
            {
                period: '14d' as const,
                date: fixedDate,
                since: '2026-03-04',
                until: '2026-03-17',
                descriptionContains: '14 days',
            },
            {
                period: '30d' as const,
                date: fixedDate,
                since: '2026-02-16',
                until: '2026-03-17',
                descriptionContains: '30 days',
            },
            {
                period: 'this-week' as const,
                date: fixedDate, // Tuesday
                since: '2026-03-16',
                until: '2026-03-17',
                descriptionContains: 'this week',
            },
            {
                period: 'this-week' as const,
                date: new Date('2026-03-16T12:00:00Z'), // Monday
                since: '2026-03-16',
                until: '2026-03-16',
                descriptionContains: 'this week',
            },
            {
                period: 'this-week' as const,
                date: new Date('2026-03-22T12:00:00Z'), // Sunday
                since: '2026-03-16',
                until: '2026-03-22',
                descriptionContains: 'this week',
            },
            {
                period: 'this-month' as const,
                date: fixedDate,
                since: '2026-03-01',
                until: '2026-03-17',
                descriptionContains: 'this month',
            },
        ])(
            'should compute "$period" period ($since to $until)',
            ({ period, date, since, until, descriptionContains }) => {
                const range = computeDateRange(period, date)

                expect(range.since).toBe(since)
                expect(range.until).toBe(until)
                expect(range.periodDescription).toContain(descriptionContains)
            },
        )

        it.each([
            { period: 'today' as const, since: '2026-03-16', until: '2026-03-16' },
            { period: '7d' as const, since: '2026-03-10', until: '2026-03-16' },
            { period: 'this-week' as const, since: '2026-03-16', until: '2026-03-16' },
            { period: 'this-month' as const, since: '2026-03-01', until: '2026-03-16' },
        ])(
            'should count "$period" from the date in the given offset',
            ({ period, since, until }) => {
                // 11 PM Monday March 16 in Chicago (UTC-5), already Tuesday in UTC
                const range = computeDateRange(period, new Date('2026-03-17T04:00:00Z'), -300)

                expect(range.since).toBe(since)
                expect(range.until).toBe(until)
            },
        )

        it.each([
            { startDay: 7, dayName: 'Sunday', date: '2026-03-22', since: '2026-03-22' },
            { startDay: 7, dayName: 'Sunday', date: '2026-03-21', since: '2026-03-15' },
            { startDay: 6, dayName: 'Saturday', date: '2026-03-20', since: '2026-03-14' },
        ])(
            'should start "this-week" on $dayName for a week starting on day $startDay ($date)',
            ({ startDay, dayName, date, since }) => {
                const range = computeDateRange(
                    'this-week',
                    new Date(`${date}T12:00:00Z`),
                    0,
                    startDay,
                )

                expect(range.since).toBe(since)
                expect(range.until).toBe(date)
                expect(range.periodDescription).toBe(`this week (${dayName} to today)`)
            },
        )

        it.each([0, 8, 1.5])(
            'should start "this-week" on Monday for a week start day outside 1 to 7 (%s)',
            (startDay) => {
                const range = computeDateRange(
                    'this-week',
                    new Date('2026-11-25T12:00:00Z'), // Wednesday
                    0,
                    startDay,
                )

                expect(range.since).toBe('2026-11-23')
                expect(range.periodDescription).toBe('this week (Monday to today)')
            },
        )

        it('should embed date range in the prompt text', () => {
            const text = buildPromptText({ period: '7d', focus: 'overall' })

            expect(text).toMatch(/since: "\d{4}-\d{2}-\d{2}"/)
            expect(text).toMatch(/until: "\d{4}-\d{2}-\d{2}"/)
        })
    })
})
