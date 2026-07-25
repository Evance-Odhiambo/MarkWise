// src/theme/useColors.js
// Drop-in, theme-aware replacement for `import colors from '../theme/colors'`.
//
// Usage in any screen:
//   import { useColors } from '../theme';
//   const colors = useColors();           // same shape as colors.js
//   // Now colors.background / .surface / .text / .border respond to dark mode.
//
// Semantic brand colors (primary, success, danger, …) are identical in both
// themes, so they pass through unchanged.

import { useMemo } from 'react';
import { useTheme } from './ThemeContext';
import lightColors from './colors';

export function useColors() {
  const { theme } = useTheme();

  return useMemo(() => {
    // Light mode: the static colors object is already correct — avoid allocation.
    if (!theme.dark) return lightColors;

    // Dark mode: override the five theme-sensitive namespaces.
    return {
      ...lightColors,                        // brand palette (primary, success, …)
      background: theme.colors.background,
      surface:    theme.colors.surface,
      text:       theme.colors.text,
      border:     theme.colors.border,
      overlay:    theme.colors.overlay,
    };
  }, [theme]);
}
