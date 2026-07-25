// achievementsApi.js — student achievements & gamification data
import { API_BASE_URL } from './constants';
import { getStudentSession } from './authSession';
import AsyncStorage from '@react-native-async-storage/async-storage';

const CACHE_KEY = 'markwise.student.achievements.v1';

/**
 * Fetches the full achievements payload for the current student.
 *
 * Expected backend response shape (all fields optional — screen handles nulls):
 * {
 *   totalSessions:    number,   // total conducted sessions across all units
 *   attended:         number,   // sessions the student was marked present
 *   percent:          number,   // overall attendance percentage (0-100)
 *   currentStreak:    number,   // current consecutive-day streak
 *   longestStreak:    number,   // all-time longest streak
 *   perfectWeeks:     number,   // weeks with 100% attendance
 *   perfectMonths:    number,   // months with 100% attendance
 *   ontimeCount:      number,   // times marked within first 5 min of session
 *   earlyBirdCount:   number,   // times in first 10% to mark attendance
 *   comebacks:        number,   // sessions attended after 3+ consecutive misses
 *   firstSessionDone: boolean,  // has the student attended at least 1 session?
 *   unitsAbove90:     string[], // unit codes where attendance >= 90%
 *   groupLeaderCount: number,   // times first in class to mark attendance
 *   rank:             number,   // leaderboard rank within cohort/course
 *   totalStudents:    number,   // total students in cohort for rank context
 *   leaderboard: [              // top students for the class leaderboard
 *     { id, name, points, avatar? }
 *   ],
 *   dailyChallenges: [          // today's challenges (backend defines them)
 *     { id, title, description, icon, points, completed }
 *   ],
 *   weeklyQuests: [             // this week's quests
 *     { id, name, description, progress, target, points }
 *   ]
 * }
 *
 * Returns null on network failure or when the endpoint does not exist yet.
 * The screen falls back to cached data → then zero state.
 */
export async function fetchStudentAchievements() {
  const session = await getStudentSession();
  if (!session?.token) return null;
  try {
    const res = await fetch(`${API_BASE_URL}/api/student/achievements`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    if (data) {
      await AsyncStorage.setItem(CACHE_KEY, JSON.stringify({ ...data, _cachedAt: Date.now() })).catch(() => {});
    }
    return data ?? null;
  } catch {
    return null;
  }
}

/**
 * Returns the last successfully fetched achievements data from local storage,
 * or null if none is cached yet.
 */
export async function getCachedAchievements() {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
