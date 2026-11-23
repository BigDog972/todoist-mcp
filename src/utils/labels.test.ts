import { formatLabelsForDisplay, generateLabelsFilter, matchesLabels } from './labels.js'

describe('generateLabelsFilter', () => {
    it('returns an empty string when there are no labels', () => {
        expect(generateLabelsFilter([])).toBe('')
        expect(generateLabelsFilter()).toBe('')
    })

    it('prefixes plain label names with @', () => {
        expect(generateLabelsFilter(['work'])).toBe('(@work)')
        expect(generateLabelsFilter(['work', 'urgent'], 'and')).toBe('(@work  &  @urgent)')
    })

    it.each([
        { name: 'ampersand', label: 'R&D', expected: '(@R\\&D)' },
        { name: 'parentheses', label: 'Errands (car)', expected: '(@Errands \\(car\\))' },
        { name: 'comma', label: 'home,office', expected: '(@home\\,office)' },
        { name: 'pipe', label: 'this|that', expected: '(@this\\|that)' },
        { name: 'exclamation mark', label: 'urgent!', expected: '(@urgent\\!)' },
        { name: 'backslash', label: 'a\\b', expected: '(@a\\\\b)' },
    ])('escapes filter operators in label names: $name', ({ label, expected }) => {
        expect(generateLabelsFilter([label])).toBe(expected)
    })

    it('escapes a label that already starts with @ without escaping the prefix', () => {
        expect(generateLabelsFilter(['@R&D'])).toBe('(@R\\&D)')
    })

    it('trims whitespace around label names, which Todoist never keeps in a name', () => {
        expect(generateLabelsFilter(['  work ', ' @R&D '])).toBe('(@work  |  @R\\&D)')
    })

    it('keeps the operator between escaped labels unescaped', () => {
        expect(generateLabelsFilter(['R&D', 'Errands (car)'], 'or')).toBe(
            '(@R\\&D  |  @Errands \\(car\\))',
        )
        expect(generateLabelsFilter(['R&D', 'home,office'], 'and')).toBe(
            '(@R\\&D  &  @home\\,office)',
        )
    })
})

describe('formatLabelsForDisplay', () => {
    it('adds @ only to labels that do not already start with it', () => {
        expect(formatLabelsForDisplay(['@work', 'personal'])).toBe('@work | @personal')
    })

    it('joins labels with the chosen operator', () => {
        expect(formatLabelsForDisplay(['work', 'urgent'], 'and')).toBe('@work & @urgent')
        expect(formatLabelsForDisplay(['work', 'urgent'], 'or')).toBe('@work | @urgent')
    })

    it('trims whitespace and leaves filter operators unescaped', () => {
        expect(formatLabelsForDisplay([' R&D ', ' @Errands (car)'])).toBe('@R&D | @Errands (car)')
    })
})

describe('matchesLabels', () => {
    const taskLabels = ['work', 'R&D']

    it.each([
        { labels: ['work'], operator: 'or' as const, expected: true },
        { labels: ['@work'], operator: 'or' as const, expected: true },
        { labels: [' @R&D '], operator: 'or' as const, expected: true },
        { labels: ['@home'], operator: 'or' as const, expected: false },
        { labels: ['@work', '@R&D'], operator: 'and' as const, expected: true },
        { labels: ['@work', '@home'], operator: 'and' as const, expected: false },
    ])(
        'reads $labels with $operator the way the filter query does',
        ({ labels, operator, expected }) => {
            expect(matchesLabels(taskLabels, labels, operator)).toBe(expected)
        },
    )

    it('defaults to "or"', () => {
        expect(matchesLabels(taskLabels, ['@home', '@work'])).toBe(true)
    })
})
