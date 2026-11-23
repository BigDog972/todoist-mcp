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

/**
 * The label name a caller meant: without surrounding whitespace, which Todoist never
 * keeps in a name, or a leading `@`.
 */
function toLabelName(label: string): string {
    const trimmed = label.trim()
    return trimmed.startsWith('@') ? trimmed.slice(1) : trimmed
}

export function generateLabelsFilter(labels: string[] = [], labelsOperator: LabelsOperator = 'or') {
    if (labels.length === 0) return ''
    const operator = labelsOperator === 'and' ? ' & ' : ' | '
    // Add @ prefix to labels for Todoist API query, escaping characters such as
    // `&`, `(` and `,` that would otherwise be read as filter operators.
    const prefixedLabels = labels.map((label) => `@${escapeFilterToken(toLabelName(label))}`)
    const labelStr = prefixedLabels.join(` ${operator} `)
    return `(${labelStr})`
}

/**
 * The labels as `@name`, joined by the operator, for the summary shown to the model.
 * Names are shown as given, without the escaping a filter query needs.
 */
export function formatLabelsForDisplay(
    labels: string[],
    labelsOperator: LabelsOperator = 'or',
): string {
    return labels
        .map((label) => `@${toLabelName(label)}`)
        .join(labelsOperator === 'and' ? ' & ' : ' | ')
}
