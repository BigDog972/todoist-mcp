import { escapeFilterToken } from '@todoist/sdk'
import { z } from 'zod'
import { ApiLimits } from './constants.js'

const LABELS_OPERATORS = ['and', 'or'] as const
type LabelsOperator = (typeof LABELS_OPERATORS)[number]

export const LabelsSchema = {
    labels: z
        .string()
        .array()
        .max(ApiLimits.FILTER_VALUES_MAX)
        .optional()
        .describe('The labels to filter the tasks by'),
    labelsOperator: z
        .enum(LABELS_OPERATORS)
        .optional()
        .describe(
            'The operator to use when filtering by labels. This will dictate whether a task has all labels, or some of them. Default is "or".',
        ),
}

export function generateLabelsFilter(labels: string[] = [], labelsOperator: LabelsOperator = 'or') {
    if (labels.length === 0) return ''
    const operator = labelsOperator === 'and' ? ' & ' : ' | '
    // Add @ prefix to labels for Todoist API query, escaping characters such as
    // `&`, `(` and `,` that would otherwise be read as filter operators.
    const prefixedLabels = labels.map(
        (label) => `@${escapeFilterToken(label.startsWith('@') ? label.slice(1) : label)}`,
    )
    const labelStr = prefixedLabels.join(` ${operator} `)
    return `(${labelStr})`
}
