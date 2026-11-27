import type { Section, TodoistApi } from '@todoist/sdk'
import { z } from 'zod'
import type { TodoistTool } from '../todoist-tool.js'
import { logBatchFailures, partitionSettled } from '../utils/batch-failures.js'
import { BatchLimits } from '../utils/constants.js'
import {
    FailureSchema,
    SectionSchema as SectionOutputSchema,
    toSectionSummary,
} from '../utils/output-schemas.js'
import { appendFailureSummary } from '../utils/response-builders.js'
import { executeWithRetry } from '../utils/retry.js'
import { ToolNames } from '../utils/tool-names.js'

const SectionUpdateSchema = z
    .object({
        id: z.string().min(1).describe('The ID of the section to update.'),
        name: z.string().min(1).optional().describe('The new name of the section.'),
        description: z
            .preprocess(
                // `null` is the advertised clear value; the param schema stays a
                // plain string (Gemini forbids nullable schemas, not preprocessing),
                // so `null` is normalised to "" and then mapped to the section
                // wire clear (`null`) at execute.
                (value) => (value === null ? '' : value),
                z
                    .string()
                    .describe(
                        'The description of the section (Markdown). Pass null (or an empty string) to clear it.',
                    ),
            )
            .optional(),
        isArchived: z
            .boolean()
            .optional()
            .describe(
                `true archives (keeping its tasks, unlike ${ToolNames.DELETE_OBJECT}), false unarchives.`,
            ),
    })
    .refine(
        (data) =>
            data.name !== undefined ||
            data.description !== undefined ||
            data.isArchived !== undefined,
        { message: 'Provide at least one of "name", "description" or "isArchived" to update.' },
    )

const ArgsSchema = {
    sections: z
        .array(SectionUpdateSchema)
        .min(1)
        .max(BatchLimits.ITEMS_PER_OPERATION)
        .describe('The sections to update.'),
}

const OutputSchema = {
    sections: z.array(SectionOutputSchema).describe('The updated sections.'),
    totalCount: z.number().describe('The total number of sections updated.'),
    updatedSectionIds: z.array(z.string()).describe('The IDs of the updated sections.'),
    failures: z
        .array(FailureSchema)
        .describe('Sections that could not be updated, with the reason for each.'),
    appliedOperations: z.object({
        updateCount: z.number(),
        failureCount: z.number(),
    }),
}

const updateSections = {
    name: ToolNames.UPDATE_SECTIONS,
    description: 'Update, archive or unarchive multiple existing sections.',
    parameters: ArgsSchema,
    outputSchema: OutputSchema,
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: false },
    async execute({ sections }, client) {
        // Each section is updated independently, so one rejection neither discards the
        // sections that were updated nor hides them behind one error.
        const settled = await Promise.allSettled(
            sections.map((section) => updateSection(section, client)),
        )

        const { succeeded, failures } = partitionSettled(sections, settled, (section) => section.id)
        const updatedSections = succeeded.map(({ value }) => value)

        logBatchFailures(ToolNames.UPDATE_SECTIONS, sections.length, failures)

        const textContent = generateTextContent({
            updated: succeeded.map(({ item, value }) => ({
                section: value,
                isArchived: item.isArchived,
            })),
            failures,
        })

        return {
            textContent,
            structuredContent: {
                sections: updatedSections.map(toSectionSummary),
                totalCount: updatedSections.length,
                updatedSectionIds: updatedSections.map((section) => section.id),
                failures,
                appliedOperations: {
                    updateCount: updatedSections.length,
                    failureCount: failures.length,
                },
            },
        }
    },
} satisfies TodoistTool<typeof ArgsSchema, typeof OutputSchema>

/**
 * Apply one section's changes. A section is unarchived before it is renamed and
 * archived after, so the field update never lands on an archived section, and the
 * section returned is the one from the last call.
 */
async function updateSection(
    { id, name, description, isArchived }: z.infer<typeof SectionUpdateSchema>,
    client: TodoistApi,
): Promise<Section> {
    let section: Section | undefined

    if (isArchived === false) {
        section = await executeWithRetry(() => client.unarchiveSection(id))
    }

    if (name !== undefined || description !== undefined) {
        // The SDK's UpdateSectionArgs is RequireAtLeastOne, which a
        // dynamically-built partial can't satisfy statically; the check above
        // guarantees at least one field. An empty `description` clears it, which
        // the section wire represents as `null` (backend NULL_CLEARS).
        const updateArgs = {
            ...(name !== undefined ? { name } : {}),
            ...(description !== undefined
                ? { description: description === '' ? null : description }
                : {}),
        } as Parameters<typeof client.updateSection>[1]
        section = await executeWithRetry(() => client.updateSection(id, updateArgs))
    }

    if (isArchived === true) {
        section = await executeWithRetry(() => client.archiveSection(id))
    }

    // The schema refine guarantees at least one of the calls above ran.
    return section as Section
}

const ARCHIVE_NOTE = { true: ' - archived', false: ' - unarchived' } as const

function generateTextContent({
    updated,
    failures,
}: {
    updated: Array<{ section: Section; isArchived: boolean | undefined }>
    failures: Array<{ item: string; error: string }>
}) {
    const count = updated.length
    const sectionList = updated
        .map(({ section, isArchived }) => {
            const note = isArchived === undefined ? '' : ARCHIVE_NOTE[`${isArchived}`]
            return `• ${section.name} (id=${section.id}, projectId=${section.projectId})${note}`
        })
        .join('\n')

    const summary =
        count > 0
            ? `Updated ${count} section${count === 1 ? '' : 's'}:\n${sectionList}`
            : 'Updated 0 sections'

    return appendFailureSummary(summary, failures)
}

export { updateSections }
