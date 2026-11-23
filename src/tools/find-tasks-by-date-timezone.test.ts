import type { TodoistApi } from '@todoist/sdk'
import { type Mocked, type MockedFunction, vi } from 'vitest'
import { getTasksByFilter } from '../tool-helpers.js'
import { createMappedTask, createMockUser } from '../utils/test-helpers.js'
import { findTasksByDate } from './find-tasks-by-date.js'

// Mock only getTasksByFilter and user resolver — do NOT mock date-fns
vi.mock('../tool-helpers', async () => {
    const actual = (await vi.importActual('../tool-helpers')) as typeof import('../tool-helpers.js')
    return {
        ...actual,
        getTasksByFilter: vi.fn(),
    }
})

vi.mock('../utils/user-resolver', () => ({
    resolveUserNameToId: vi.fn(),
    getAssigneeShortNames: vi.fn(async () => new Map<string, string>()),
    SELF_USER_KEYWORD: 'me',
}))

const mockGetTasksByFilter = getTasksByFilter as MockedFunction<typeof getTasksByFilter>

const mockTodoistApi = {
    getUser: vi.fn(),
} as unknown as Mocked<TodoistApi>

const mockTodoistUser = createMockUser()

describe('find-tasks-by-date timezone handling', () => {
    const originalTZ = process.env.TZ

    beforeEach(() => {
        vi.clearAllMocks()
        mockTodoistApi.getUser.mockResolvedValue(mockTodoistUser)

        const mockTasks = [createMappedTask({ content: 'Test task', dueDate: '2025-08-20' })]
        mockGetTasksByFilter.mockResolvedValue({ tasks: mockTasks, nextCursor: null })
    })

    afterEach(() => {
        // Restore original timezone
        if (originalTZ !== undefined) {
            process.env.TZ = originalTZ
        } else {
            delete process.env.TZ
        }
        vi.restoreAllMocks()
    })

    describe('explicit date in negative UTC offset (America/New_York, UTC-5)', () => {
        beforeEach(() => {
            process.env.TZ = 'America/New_York'
        })

        it('should compute correct end date for daysCount=1', async () => {
            await findTasksByDate.execute(
                { startDate: '2025-08-20', limit: 50, daysCount: 1 },
                mockTodoistApi,
            )

            const call = mockGetTasksByFilter.mock.calls[0]?.[0]
            expect(call?.query).toContain('due before: 2025-08-21')
        })

        it('should compute correct end date for daysCount=3', async () => {
            await findTasksByDate.execute(
                { startDate: '2025-08-20', limit: 50, daysCount: 3 },
                mockTodoistApi,
            )

            const call = mockGetTasksByFilter.mock.calls[0]?.[0]
            expect(call?.query).toContain('due before: 2025-08-23')
        })
    })

    describe('explicit date in positive UTC offset (Asia/Tokyo, UTC+9)', () => {
        beforeEach(() => {
            process.env.TZ = 'Asia/Tokyo'
        })

        it('should compute correct end date for daysCount=1', async () => {
            await findTasksByDate.execute(
                { startDate: '2025-08-20', limit: 50, daysCount: 1 },
                mockTodoistApi,
            )

            const call = mockGetTasksByFilter.mock.calls[0]?.[0]
            expect(call?.query).toContain('due before: 2025-08-21')
        })

        it('should compute correct end date for daysCount=3', async () => {
            await findTasksByDate.execute(
                { startDate: '2025-08-20', limit: 50, daysCount: 3 },
                mockTodoistApi,
            )

            const call = mockGetTasksByFilter.mock.calls[0]?.[0]
            expect(call?.query).toContain('due before: 2025-08-23')
        })
    })

    describe('"today" with daysCount > 1 across timezones', () => {
        // 2025-08-15T23:00:00Z
        // For a user at -04:00 (New York, EDT): Aug 15, 7pm
        // For a user at +09:00 (Tokyo): Aug 16, 8am
        // "Today" is the user's Todoist timezone, whatever the server's clock says.

        function userAt(timezone: string, gmtString: string, hours: number) {
            return createMockUser({
                tzInfo: { timezone, gmtString, hours, minutes: 0, isDst: 0 },
            })
        }

        it.each([
            { serverTZ: 'Asia/Tokyo', label: 'on a server in Tokyo' },
            { serverTZ: 'UTC', label: 'on a UTC server' },
        ])("uses the New York user's today (Aug 15) $label", async ({ serverTZ }) => {
            process.env.TZ = serverTZ
            mockTodoistApi.getUser.mockResolvedValue(userAt('America/New_York', '-04:00', -4))
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2025-08-15T23:00:00Z'))

            try {
                await findTasksByDate.execute(
                    { startDate: 'today', limit: 50, daysCount: 3 },
                    mockTodoistApi,
                )

                const call = mockGetTasksByFilter.mock.calls[0]?.[0]
                expect(call?.query).toContain('due: 2025-08-15')
                expect(call?.query).toContain('due before: 2025-08-18')
            } finally {
                vi.useRealTimers()
            }
        })

        it('starts a multi-day "today" range on the user\'s date, not the server\'s', async () => {
            // 9 PM on Aug 15 at -06:00 is already 03:00 on Aug 16 on a UTC server. Starting the
            // range on Aug 16 would drop tasks due Aug 15: they are neither overdue nor in range.
            process.env.TZ = 'UTC'
            mockTodoistApi.getUser.mockResolvedValue(userAt('America/Chicago', '-06:00', -6))
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2025-08-16T03:00:00Z'))

            try {
                await findTasksByDate.execute(
                    { startDate: 'today', limit: 50, daysCount: 3 },
                    mockTodoistApi,
                )

                const call = mockGetTasksByFilter.mock.calls[0]?.[0]
                expect(call?.query).toBe(
                    '((due after: 2025-08-15 | due: 2025-08-15) & due before: 2025-08-18 | overdue) & !assigned to: others',
                )
            } finally {
                vi.useRealTimers()
            }
        })

        it.each([
            { serverTZ: 'America/New_York', label: 'on a server in New York' },
            { serverTZ: 'UTC', label: 'on a UTC server' },
        ])("uses the Tokyo user's today (Aug 16) $label", async ({ serverTZ }) => {
            process.env.TZ = serverTZ
            mockTodoistApi.getUser.mockResolvedValue(userAt('Asia/Tokyo', '+09:00', 9))
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2025-08-15T23:00:00Z'))

            try {
                await findTasksByDate.execute(
                    { startDate: 'today', limit: 50, daysCount: 3 },
                    mockTodoistApi,
                )

                const call = mockGetTasksByFilter.mock.calls[0]?.[0]
                expect(call?.query).toContain('due: 2025-08-16')
                expect(call?.query).toContain('due before: 2025-08-19')
            } finally {
                vi.useRealTimers()
            }
        })

        it("falls back to UTC, not the server's zone, when the user lookup fails", async () => {
            // 03:00 UTC on Aug 16 is still Aug 15 on a server in New York.
            process.env.TZ = 'America/New_York'
            const lookupError = new Error('Network error')
            mockTodoistApi.getUser.mockRejectedValue(lookupError)
            const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2025-08-16T03:00:00Z'))

            try {
                await findTasksByDate.execute(
                    { startDate: 'today', limit: 50, daysCount: 3 },
                    mockTodoistApi,
                )

                const call = mockGetTasksByFilter.mock.calls[0]?.[0]
                expect(call?.query).toBe(
                    '((due after: 2025-08-16 | due: 2025-08-16) & due before: 2025-08-19 | overdue) & !assigned to: others',
                )
                expect(consoleError).toHaveBeenCalledWith(
                    "find-tasks-by-date: could not load the user's timezone, using UTC",
                    lookupError,
                )
            } finally {
                vi.useRealTimers()
            }
        })

        it('retries a transient user lookup failure before falling back', async () => {
            process.env.TZ = 'UTC'
            mockTodoistApi.getUser
                .mockRejectedValueOnce(
                    Object.assign(new Error('Service Unavailable'), { httpStatusCode: 503 }),
                )
                .mockResolvedValueOnce(userAt('America/Chicago', '-06:00', -6))
            vi.useFakeTimers()
            vi.setSystemTime(new Date('2025-08-16T03:00:00Z'))

            try {
                const pending = findTasksByDate.execute(
                    { startDate: 'today', limit: 50, daysCount: 3 },
                    mockTodoistApi,
                )
                await vi.runAllTimersAsync()
                await pending

                expect(mockTodoistApi.getUser).toHaveBeenCalledTimes(2)
                const call = mockGetTasksByFilter.mock.calls[0]?.[0]
                expect(call?.query).toBe(
                    '((due after: 2025-08-15 | due: 2025-08-15) & due before: 2025-08-18 | overdue) & !assigned to: others',
                )
            } finally {
                vi.useRealTimers()
            }
        })
    })
})
