import { describeDateRange, describeDaysFromToday } from '../../utils/date.js'
import type { FindTasksByDateArgs } from './types'

type TitleArgs = Pick<FindTasksByDateArgs, 'startDate' | 'daysCount' | 'overdueOption'>

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * The heading for the task list, describing what the search that produced it covered.
 * Tool input reaches the widget before the server validates it, so a start date that
 * is not YYYY-MM-DD is shown as given rather than counted.
 */
function getTaskListTitle(args: TitleArgs | null): string {
    if (args?.overdueOption === 'overdue-only') {
        return 'Overdue tasks'
    }

    const daysCount = args?.daysCount ?? 1

    if (!args?.startDate || args.startDate === 'today') {
        return `Tasks for ${describeDaysFromToday(daysCount)}`
    }

    if (!DATE_PATTERN.test(args.startDate)) {
        return `Tasks for ${args.startDate}`
    }

    return `Tasks for ${describeDateRange(args.startDate, daysCount)}`
}

export { getTaskListTitle }
