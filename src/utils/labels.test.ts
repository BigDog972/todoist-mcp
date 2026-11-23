import { generateLabelsFilter } from './labels.js'

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

    it('keeps the operator between escaped labels unescaped', () => {
        expect(generateLabelsFilter(['R&D', 'Errands (car)'], 'or')).toBe(
            '(@R\\&D  |  @Errands \\(car\\))',
        )
        expect(generateLabelsFilter(['R&D', 'home,office'], 'and')).toBe(
            '(@R\\&D  &  @home\\,office)',
        )
    })
})
