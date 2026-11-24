import type { GetPromptResult } from '@modelcontextprotocol/server'
import type { TodoistApi } from '@todoist/sdk'
import { z } from 'zod'
import { getDateInOffset, parseGmtOffsetToMinutes, shiftDateStringByDays } from '../utils/date.js'
import { executeWithRetry } from '../utils/retry.js'

const argsSchema = z.object({
    period: z
        .enum(['today', '7d', '14d', '30d', 'this-week', 'this-month'])
        .default('7d')
        .describe(
            'Time period for the analysis. "today" analyzes the current day, "7d"/"14d"/"30d" analyze the last N days, "this-week" and "this-month" analyze the current week or month.',
        ),
    focus: z
        .enum(['overall', 'goals', 'projects', 'trends', 'recommendations'])
        .default('overall')
        .describe(
            'Focus area for the analysis. "overall" provides a comprehensive report covering all areas. Other values focus on a specific aspect.',
        ),
    projectId: z
        .string()
        .optional()
        .describe('Optional project ID to scope the analysis to a specific project.'),
})

type PromptArgs = z.infer<typeof argsSchema>

/**
 * Compute the date range (since/until as YYYY-MM-DD) for a given period.
 * "Today" is the date at `offsetMinutes` from UTC, which the prompt callback sets to
 * the user's Todoist timezone, so the range follows the user's calendar rather than
 * the server's. The arithmetic runs on UTC calendar dates, so the server's own
 * timezone and daylight-saving changes cannot move a day.
 */
function computeDateRange(
    period: PromptArgs['period'],
    now: Date = new Date(),
    offsetMinutes = 0,
): { since: string; until: string; periodDescription: string } {
    const until = getDateInOffset(now, offsetMinutes)
    const daysBefore = (days: number) => shiftDateStringByDays(until, -days)

    switch (period) {
        case 'today':
            return { since: until, until, periodDescription: 'today' }

        case '7d':
            return { since: daysBefore(6), until, periodDescription: 'the last 7 days' }

        case '14d':
            return { since: daysBefore(13), until, periodDescription: 'the last 14 days' }

        case '30d':
            return { since: daysBefore(29), until, periodDescription: 'the last 30 days' }

        case 'this-week': {
            const dayOfWeek = new Date(`${until}T00:00:00Z`).getUTCDay()
            return {
                since: daysBefore((dayOfWeek + 6) % 7),
                until,
                periodDescription: 'this week (Monday to today)',
            }
        }

        case 'this-month':
            return {
                since: `${until.slice(0, 8)}01`,
                until,
                periodDescription: 'this month',
            }
    }
}

/**
 * The user's offset from UTC in minutes, from their Todoist timezone. A failed lookup
 * falls back to UTC rather than failing the prompt, at the cost of a range that can
 * be a day off for a user near midnight.
 */
async function getUserOffsetMinutes(client: TodoistApi): Promise<number> {
    try {
        const user = await executeWithRetry(() => client.getUser())
        return parseGmtOffsetToMinutes(user.tzInfo?.gmtString || '+00:00')
    } catch (error) {
        console.error("productivity-analysis: could not load the user's timezone, using UTC", error)
        return 0
    }
}

function buildFocusSections(focus: PromptArgs['focus']): string {
    const sections: Record<string, string> = {
        goals: `### Goal Tracking
- Compare tasks completed today vs the daily goal
- Calculate progress toward the weekly goal (using daysItems to sum completions for the current week)
- Report on the current daily and weekly streaks — how long they've been going, and how they compare to the user's best streaks
- Flag if the user is at risk of breaking a streak`,

        trends: `### Completion Trends
- Show a day-by-day breakdown of tasks completed over the period
- Identify peak productivity days and low-activity days
- Note any patterns (e.g., weekday vs weekend, specific days that are consistently high or low)
- Compare weekly totals if multiple weeks are in the period`,

        projects: `### Project Distribution
- Break down completions by project (using per-project data from daysItems/weekItems)
- Identify which projects received the most and least attention
- Highlight any projects with zero completions in the period
- If a specific project was requested, focus the analysis on that project's performance`,

        recommendations: `### Karma & Momentum
- Report the current karma score and trend
- Summarize recent karma changes and their reasons

### Recommendations
- Based on all the data gathered, provide 3-5 specific, actionable suggestions
- Address any concerning patterns (declining completions, broken streaks, neglected projects)
- Suggest concrete next steps (e.g., "Focus on Project X which has had no completions this week")
- If goals seem too easy or too hard based on actual completion rates, suggest adjustments`,
    }

    if (focus === 'overall') {
        return Object.values(sections).join('\n\n')
    }

    return sections[focus] ?? ''
}

function buildPromptText(
    args: PromptArgs,
    range: ReturnType<typeof computeDateRange> = computeDateRange(args.period),
): string {
    const { since, until, periodDescription } = range
    const projectScope = args.projectId
        ? `\nScope this analysis to project ID: ${args.projectId}. Pass this projectId when calling find-completed-tasks and get-overview.`
        : ''

    return `Analyze my Todoist productivity for ${periodDescription} (${since} to ${until}).${projectScope}

## Instructions

Follow these steps to gather data and produce the analysis:

### Step 1: Gather Data

Call the following tools to collect the necessary data:

1. **user-info** — Get my timezone, daily/weekly goals, tasks completed today, and user ID (you'll need the user ID for the responsibleUser filter)
2. **get-productivity-stats** — Get streak data, karma score/trend, daily and weekly completion breakdowns, and karma history
3. **find-completed-tasks** — Get completed tasks for the period (since: "${since}", until: "${until}"). Set responsibleUser to my user ID (from user-info) to see only my completions${args.projectId ? `. Set projectId to "${args.projectId}"` : ''}
${args.focus === 'overall' || args.focus === 'projects' ? `4. **get-overview** — Get the project structure${args.projectId ? ` for project "${args.projectId}"` : ''} to provide context for the analysis` : ''}

### Step 2: Analyze

Using the collected data, produce an analysis covering the following sections:

${buildFocusSections(args.focus)}

### Step 3: Format

Present the analysis as a clear, well-structured markdown report with:
- A summary header with the period and key headline metrics
- Each analytical section with its own header
- Specific numbers and comparisons (not vague statements)
- Actionable takeaways highlighted clearly`
}

async function callback(args: PromptArgs, client: TodoistApi): Promise<GetPromptResult> {
    const range = computeDateRange(args.period, new Date(), await getUserOffsetMinutes(client))
    return {
        messages: [
            {
                role: 'user',
                content: {
                    type: 'text',
                    text: buildPromptText(args, range),
                },
            },
        ],
    }
}

const productivityAnalysis = {
    name: 'productivity-analysis',
    title: 'Productivity Analysis',
    description:
        'Analyze your Todoist productivity with insights on completion trends, goal streaks, project distribution, and actionable recommendations. Gathers data from multiple tools and synthesizes a comprehensive report.',
    argsSchema,
    callback,
}

export { buildPromptText, computeDateRange, productivityAnalysis }
