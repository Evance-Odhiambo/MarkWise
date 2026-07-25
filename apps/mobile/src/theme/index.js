// src/theme/index.js
// Single entry point for all theme imports.
//
// Preferred usage in new screens:
//   import { useTheme } from '../theme';
//   const { theme, isDark, toggleTheme } = useTheme();
//   // access: theme.colors.background.primary, theme.typography.h1, etc.
//
// Legacy screens can still use:
//   import colors from '../theme/colors';

export { useTheme, ThemeProvider } from './ThemeContext';
export { useColors }              from './useColors';
export { lightTheme, darkTheme }   from './theme';
export { typography, fontWeight }  from './typography';
export { spacing, borderRadius }   from './spacing';
export { default as palette }      from './palette';
export { default as colors }       from './colors';
