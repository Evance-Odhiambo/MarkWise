// src/theme/ThemeContext.js
// System-aware theme provider with manual override and AsyncStorage persistence.
//
// Usage:
//   const { theme, isDark, preference, toggleTheme, setTheme } = useTheme();
//
// preference values: 'system' | 'light' | 'dark'
//   'system'  → follows the device's appearance setting (default)
//   'light'   → always light regardless of device setting
//   'dark'    → always dark regardless of device setting

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useColorScheme } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { lightTheme, darkTheme } from './theme';

// ── Constants ────────────────────────────────────────────────────────────────
const STORAGE_KEY = '@markwise/theme_preference';
const VALID_PREFS  = ['system', 'light', 'dark'];

// ── Context ───────────────────────────────────────────────────────────────────
const ThemeContext = createContext({
  theme:        lightTheme,
  isDark:       false,
  preference:   'system',
  setTheme:     () => {},
  toggleTheme:  () => {},
});

// ── Provider ──────────────────────────────────────────────────────────────────
export function ThemeProvider({ children }) {
  // Device-level colour scheme ('light' | 'dark' | null)
  const systemScheme = useColorScheme();

  // User's saved preference — starts as 'system' while storage loads
  const [preference, setPreferenceState] = useState('system');

  // Load persisted preference once on mount; fail silently
  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY)
      .then((saved) => {
        if (VALID_PREFS.includes(saved)) {
          setPreferenceState(saved);
        }
      })
      .catch(() => {});
  }, []);

  // Resolve which scheme actually applies right now
  const resolvedScheme =
    preference === 'system' ? (systemScheme ?? 'light') : preference;

  const isDark = resolvedScheme === 'dark';
  const theme  = isDark ? darkTheme : lightTheme;

  // Persist and apply a new preference
  const setTheme = useCallback((pref) => {
    if (!VALID_PREFS.includes(pref)) return;
    setPreferenceState(pref);
    AsyncStorage.setItem(STORAGE_KEY, pref).catch(() => {});
  }, []);

  // Toggle between light ↔ dark (bypasses system mode once toggled manually)
  const toggleTheme = useCallback(() => {
    setTheme(isDark ? 'light' : 'dark');
  }, [isDark, setTheme]);

  // Cycle through: system → light → dark → system
  const cycleTheme = useCallback(() => {
    const next = { system: 'light', light: 'dark', dark: 'system' };
    setTheme(next[preference] ?? 'system');
  }, [preference, setTheme]);

  const value = useMemo(
    () => ({ theme, isDark, preference, setTheme, toggleTheme, cycleTheme }),
    [theme, isDark, preference, setTheme, toggleTheme, cycleTheme],
  );

  return (
    <ThemeContext.Provider value={value}>
      {children}
    </ThemeContext.Provider>
  );
}

// ── Hook ─────────────────────────────────────────────────────────────────────
export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() must be called inside <ThemeProvider>');
  }
  return ctx;
}

export default ThemeContext;
