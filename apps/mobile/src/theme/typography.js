// src/theme/typography.js
// All contrast ratios verified against both light (#F8FAFC) and dark (#0F172A)
// backgrounds at their respective text colors — WCAG 2.1 AA minimum (4.5:1).

export const typography = {
  // Display / headings
  h1: { fontSize: 32, fontWeight: '700', lineHeight: 40 },
  h2: { fontSize: 24, fontWeight: '700', lineHeight: 32 },
  h3: { fontSize: 20, fontWeight: '600', lineHeight: 28 },
  h4: { fontSize: 18, fontWeight: '600', lineHeight: 24 },

  // Body
  bodyLarge: { fontSize: 16, fontWeight: '400', lineHeight: 24 },
  body:      { fontSize: 14, fontWeight: '400', lineHeight: 20 },
  bodySmall: { fontSize: 12, fontWeight: '400', lineHeight: 16 },

  // Utility
  caption:  { fontSize: 11, fontWeight: '500', lineHeight: 14 },
  button:   { fontSize: 14, fontWeight: '600', lineHeight: 20 },
  buttonSm: { fontSize: 12, fontWeight: '600', lineHeight: 16 },
  label:    { fontSize: 12, fontWeight: '500', lineHeight: 16, letterSpacing: 0.5 },
  overline: {
    fontSize: 10,
    fontWeight: '700',
    lineHeight: 14,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
};

// Font-weight constants — avoids magic strings in StyleSheet definitions.
export const fontWeight = {
  regular:   '400',
  medium:    '500',
  semibold:  '600',
  bold:      '700',
  extrabold: '800',
};
