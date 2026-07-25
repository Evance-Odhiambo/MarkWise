import { NextResponse, type NextRequest } from 'next/server';
import { verifyStudentAccessToken } from '@/lib/studentAuthJwt';
import { computeAndCachePoints } from '@/lib/gamificationEngine';
import { prisma } from '@/lib/prisma';
import { sendFcmToTokens } from '@/lib/fcm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: corsHeaders });
}

// ── Points formula ────────────────────────────────────────────────────────────
const PTS = {
  attend: 10,
  ontime: 3,
  earlyBird: 2,
  weekly_100: 25,
  monthly_100: 100,
  streak_7: 50,
  streak_30: 200,
  unit_90: 30,
  comeback: 20,
  first: 10,
  groupLeader: 15,
};

// ── Badge definitions ─────────────────────────────────────────────────────────
const BADGES = [
  { id: 'first_attend',   name: 'First Step',     emoji: '🎯', points: 10,  rarity: 'common' },
  { id: 'streak_7',       name: '7-Day Streak',   emoji: '🔥', points: 50,  rarity: 'rare' },
  { id: 'streak_14',      name: '14-Day Streak',  emoji: '🌟', points: 100, rarity: 'rare' },
  { id: 'streak_30',      name: 'Month Warrior',  emoji: '🏆', points: 200, rarity: 'legendary' },
  { id: 'perfect_week',   name: 'Perfect Week',   emoji: '⭐', points: 25,  rarity: 'uncommon' },
  { id: 'perfect_month',  name: 'Perfect Month',  emoji: '💎', points: 100, rarity: 'rare' },
  { id: 'above_90',       name: 'Top Attender',   emoji: '📈', points: 30,  rarity: 'uncommon' },
  { id: 'comeback',       name: 'Comeback Kid',   emoji: '💪', points: 20,  rarity: 'uncommon' },
  { id: 'early_bird_5',   name: 'Early Bird',     emoji: '🌅', points: 20,  rarity: 'uncommon' },
  { id: 'group_leader_3', name: 'Group Pioneer',  emoji: '🦊', points: 45,  rarity: 'rare' },
];

function earnedBadgeIds(
  stats: { firstSessionDone: boolean; longestStreak: number; perfectWeeks: number; perfectMonths: number; unitsAbove90: string[]; comebacks: number },
  earlyBirdCount: number,
  groupLeaderCount: number,
): string[] {
  const ids: string[] = [];
  if (stats.firstSessionDone) ids.push('first_attend');
  if (stats.longestStreak >= 7) ids.push('streak_7');
  if (stats.longestStreak >= 14) ids.push('streak_14');
  if (stats.longestStreak >= 30) ids.push('streak_30');
  if (stats.perfectWeeks >= 1) ids.push('perfect_week');
  if (stats.perfectMonths >= 1) ids.push('perfect_month');
  if (stats.unitsAbove90.length >= 1) ids.push('above_90');
  if (stats.comebacks >= 1) ids.push('comeback');
  if (earlyBirdCount >= 5) ids.push('early_bird_5');
  if (groupLeaderCount >= 3) ids.push('group_leader_3');
  return ids;
}

// ── Daily challenges pool ─────────────────────────────────────────────────────
const CHALLENGE_POOL = [
  { id: 'earlybird', title: 'Early Bird', description: 'Be in the first 10% to attend a session', icon: 'sunny', points: 15 },
  { id: 'perfect_day', title: 'Perfect Day', description: 'Attend every scheduled class today', icon: 'star', points: 20 },
  { id: 'ontime_all', title: 'Punctual', description: 'Mark attendance on-time in every session today', icon: 'time', points: 10 },
  { id: 'leader', title: 'Group Pioneer', description: 'Be first in your group to check in', icon: 'trophy', points: 30 },
  { id: 'unit_check', title: 'Show Up', description: 'Attend at least one session today', icon: 'school', points: 5 },
];

/** Return 3 challenges for today, deterministically seeded by day-of-year */
function getDailyChallenges(completedIds: Set<string>): Array<{
  id: string; title: string; description: string; icon: string; points: number; completed: boolean;
}> {
  const dayOfYear = Math.floor(Date.now() / 86_400_000);
  const seed = dayOfYear % CHALLENGE_POOL.length;
  const indices = [seed, (seed + 1) % CHALLENGE_POOL.length, (seed + 2) % CHALLENGE_POOL.length];
  return indices.map((i) => ({
    ...CHALLENGE_POOL[i],
    completed: completedIds.has(CHALLENGE_POOL[i].id),
  }));
}

// ── Week boundary helpers ─────────────────────────────────────────────────────
function startOfWeek(d = new Date()): Date {
  const dt = new Date(d);
  const day = dt.getDay() || 7; // Mon=1 … Sun=7
  dt.setDate(dt.getDate() - day + 1);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function startOfDay(d = new Date()): Date {
  const dt = new Date(d);
  dt.setHours(0, 0, 0, 0);
  return dt;
}

function isoWeekKey(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day); // anchor to Thursday of ISO week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

// ── Dept rank in-process cache ────────────────────────────────────────────────
// Populated on first request per department each 15-minute window.
interface DeptEntry { studentId: string; totalPoints: number }
const deptCache = new Map<string, { entries: DeptEntry[]; expiresAt: number }>();
const DEPT_CACHE_TTL = 15 * 60 * 1000;

async function getDeptRanking(departmentId: string): Promise<DeptEntry[]> {
  const hit = deptCache.get(departmentId);
  if (hit && hit.expiresAt > Date.now()) return hit.entries;
  const rows = await prisma.$queryRaw<DeptEntry[]>`
    SELECT sp."studentId", sp."totalPoints"::int AS "totalPoints"
    FROM   "StudentPoints" sp
    JOIN   "Student" s ON s.id = sp."studentId"
    WHERE  s."departmentId" = ${departmentId}
    ORDER  BY sp."totalPoints" DESC
  `;
  deptCache.set(departmentId, { entries: rows, expiresAt: Date.now() + DEPT_CACHE_TTL });
  return rows;
}

// ── Main handler ──────────────────────────────────────────────────────────────
export async function GET(req: NextRequest) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });

  let studentId: string;
  try {
    const payload = verifyStudentAccessToken(token);
    studentId = payload.studentId;
  } catch {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: corsHeaders });
  }

  try {
    // ── 1. Core gamification stats (cached, ≤ 1h stale) ──────────────────
    const gamResult = await computeAndCachePoints(studentId);
    const { stats, points: enginePoints } = gamResult;

    // ── 2. earlyBirdCount (OfflineAttendanceRecord, raw SQL) ──────────────
    //    A session qualifies if the student's position (by scannedAt) ≤ 10% of total
    const earlyBirdRows = await prisma.$queryRaw<[{ count: bigint }]>`
      WITH my_scans AS (
        SELECT "unitCode", "lectureRoom", "sessionStart", "scannedAt"
        FROM "OfflineAttendanceRecord"
        WHERE "studentId" = ${studentId}
      ),
      session_stats AS (
        SELECT
          m."unitCode", m."lectureRoom", m."sessionStart",
          COUNT(a."id") as total,
          COUNT(a."id") FILTER (WHERE a."scannedAt" < m."scannedAt") as before_me
        FROM my_scans m
        JOIN "OfflineAttendanceRecord" a
          ON a."unitCode" = m."unitCode"
          AND a."lectureRoom" = m."lectureRoom"
          AND a."sessionStart" = m."sessionStart"
        GROUP BY m."unitCode", m."lectureRoom", m."sessionStart", m."scannedAt"
      )
      SELECT COUNT(*)::int as count
      FROM session_stats
      WHERE (before_me + 1)::float / NULLIF(total, 0) <= 0.1
    `;
    const earlyBirdCount = Number(earlyBirdRows[0]?.count ?? 0);

    // ── 3. groupLeaderCount (first in group to check in) ─────────────────
    const groupLeaderRows = await prisma.$queryRaw<[{ count: bigint }]>`
      WITH my_scans AS (
        SELECT "unitCode", "lectureRoom", "sessionStart", "scannedAt"
        FROM "OfflineAttendanceRecord"
        WHERE "studentId" = ${studentId}
      ),
      my_group_mates AS (
        SELECT DISTINCT gm2."studentId"
        FROM "GroupMember" gm
        JOIN "GroupMember" gm2
          ON gm2."groupId" = gm."groupId"
          AND gm2."studentId" != ${studentId}
        WHERE gm."studentId" = ${studentId}
          AND gm."leftAt" IS NULL
          AND gm2."leftAt" IS NULL
      )
      SELECT COUNT(*)::int as count
      FROM my_scans m
      WHERE NOT EXISTS (
        SELECT 1
        FROM "OfflineAttendanceRecord" other
        JOIN my_group_mates mgm ON mgm."studentId" = other."studentId"
        WHERE other."unitCode" = m."unitCode"
          AND other."lectureRoom" = m."lectureRoom"
          AND other."sessionStart" = m."sessionStart"
          AND other."scannedAt" < m."scannedAt"
      )
    `;
    const groupLeaderCount = Number(groupLeaderRows[0]?.count ?? 0);

    // ── 4. Augmented total points (includes earlyBird + groupLeader bonuses) ──
    const augmentedTotal =
      enginePoints.total +
      earlyBirdCount * PTS.earlyBird +
      groupLeaderCount * PTS.groupLeader;

    // ── 5. Rank + totalStudents within same course ────────────────────────
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: { courseId: true, institutionId: true, departmentId: true, points: { select: { statsJson: true } } },
    });
    if (!student) return NextResponse.json({ error: 'Student not found' }, { status: 404, headers: corsHeaders });

    // Refresh this student's cached points with augmented total
    await prisma.studentPoints.upsert({
      where: { studentId },
      create: {
        studentId,
        courseId: student.courseId,
        institutionId: student.institutionId,
        totalPoints: augmentedTotal,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
        attendancePct: stats.percent,
      },
      update: {
        totalPoints: augmentedTotal,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
        attendancePct: stats.percent,
        computedAt: new Date(),
      },
    });

    const allCoursePoints = await prisma.studentPoints.findMany({
      where: { courseId: student.courseId },
      orderBy: { totalPoints: 'desc' },
      select: { studentId: true, totalPoints: true, currentStreak: true, student: { select: { name: true } } },
    });

    const totalStudents = allCoursePoints.length;
    const rank = allCoursePoints.findIndex((p) => p.studentId === studentId) + 1;

    // Rank trend: how many positions improved vs last visit (stored in statsJson)
    const prevStatsJson = (student.points?.statsJson as any) ?? {};
    const previousRank: number = prevStatsJson.previousRank ?? rank;
    const rankTrend = previousRank - rank; // positive = moved up

    // Weekly rank change: diff current rank vs last ISO week's snapshot
    const currentWeek = isoWeekKey();
    const prevWeekDate = new Date(startOfWeek().getTime() - 7 * 86_400_000);
    const prevWeek = isoWeekKey(prevWeekDate);
    const weeklyRankHistory: Record<string, number> =
      (prevStatsJson.weeklyRankHistory as Record<string, number> | undefined) ?? {};
    const lastWeekRank: number = weeklyRankHistory[prevWeek] ?? rank;
    const weeklyRankChange = lastWeekRank - rank; // positive = improved

    // Rivals: adjacent students in the global course leaderboard
    const rankIndex = allCoursePoints.findIndex((p) => p.studentId === studentId);
    const rivalAboveEntry = rankIndex > 0 ? allCoursePoints[rankIndex - 1] : null;
    const rivalBelowEntry =
      rankIndex >= 0 && rankIndex < totalStudents - 1 ? allCoursePoints[rankIndex + 1] : null;
    const rivalAbove = rivalAboveEntry
      ? { id: rivalAboveEntry.studentId, name: rivalAboveEntry.student?.name ?? "Unknown", points: rivalAboveEntry.totalPoints }
      : null;
    const rivalBelow = rivalBelowEntry
      ? { id: rivalBelowEntry.studentId, name: rivalBelowEntry.student?.name ?? "Unknown", points: rivalBelowEntry.totalPoints }
      : null;

    // Dept rank (cached per department, 15-min TTL)
    const deptEntries = student.departmentId
      ? await getDeptRanking(student.departmentId)
      : [];
    const deptTotal = deptEntries.length;
    const deptRankIdx = deptEntries.findIndex((e) => e.studentId === studentId);
    const deptRank = deptRankIdx >= 0 ? deptRankIdx + 1 : deptTotal;

    // ── 6. Leaderboard (top 10) ───────────────────────────────────────────
    const leaderboard = allCoursePoints.slice(0, 10).map((p, i) => {
      const r = i + 1;
      const streak = p.currentStreak ?? 0;
      let trend: string;
      if (r === 1) trend = 'champion';
      else if (streak >= 7) trend = 'up';
      else if (streak === 0) trend = 'down';
      else trend = 'stable';
      return {
        id: p.studentId,
        name: p.student?.name ?? 'Unknown',
        points: p.totalPoints,
        streak,
        rank: r,
        trend,
        avatar: (p.student?.name ?? '?')[0].toUpperCase(),
      };
    });

    // ── 7. newlyUnlockedBadge ─────────────────────────────────────────────
    const currentEarnedIds = earnedBadgeIds(stats, earlyBirdCount, groupLeaderCount);

    // Record any newly earned badges. UNIQUE(studentId, badgeId) + skipDuplicates
    // makes this safe to call on every request — inserts only missing rows.
    // badgeName and points are stored so the delivery response needs no in-memory lookup.
    if (currentEarnedIds.length > 0) {
      await prisma.achievementNotification.createMany({
        data: currentEarnedIds.map((badgeId) => {
          const b = BADGES.find((x) => x.id === badgeId);
          return { studentId, badgeId, badgeName: b?.name ?? '', points: b?.points ?? 0 };
        }),
        skipDuplicates: true,
      });
    }

    // Send FCM for badges not yet pushed. Idempotent: each row is pushed exactly once.
    const unsentNotifs = await prisma.achievementNotification.findMany({
      where: { studentId, fcmSent: false },
      select: { id: true, badgeId: true, badgeName: true, points: true },
      orderBy: { earnedAt: 'asc' },
    });
    if (unsentNotifs.length > 0) {
      const tokenRows = await prisma.studentPushToken.findMany({
        where: { studentId },
        select: { fcmToken: true },
      });
      const tokens = tokenRows.map((r) => r.fcmToken);
      for (const notif of unsentNotifs) {
        if (!notif.badgeName) continue; // row predates badgeName column — skip gracefully
        const pushTitle = 'Achievement Unlocked! 🏆';
        const pushBody  = `${notif.badgeName} — +${notif.points} pts`;
        if (tokens.length > 0) {
          // Include both notification (system tray) and data (in-app handler).
          // data.badgeId is the dedup key the mobile app uses in local SQLite.
          sendFcmToTokens(
            tokens,
            'achievement',
            pushTitle,
            pushBody,
            { badgeId: notif.badgeId, title: pushTitle, body: pushBody },
          ).catch((err) => console.error('[achievements] FCM push error:', err));
        }
        await prisma.achievementNotification.update({
          where: { id: notif.id },
          data: { fcmSent: true, fcmSentAt: new Date() },
        });
      }
    }

    // Deliver the oldest undelivered badge — one per request so the app shows
    // modals sequentially rather than racing. If null, the field is omitted entirely.
    // SELECT FOR UPDATE + transaction prevents a concurrent request on a second device
    // from picking up the same badge simultaneously.
    type DeliveryRow = { id: string; badgeId: string; badgeName: string; points: number };
    const deliveredRow = await prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<DeliveryRow[]>`
        SELECT id, "badgeId", "badgeName", points
        FROM   "AchievementNotification"
        WHERE  "studentId" = ${studentId} AND delivered = FALSE
        ORDER  BY "earnedAt" ASC
        LIMIT  1
        FOR    UPDATE SKIP LOCKED
      `;
      if (rows.length === 0) return null;
      const row = rows[0]!;
      await tx.achievementNotification.update({
        where: { id: row.id },
        data:  { delivered: true, deliveredAt: new Date() },
      });
      return row;
    });

    const newlyUnlockedBadge = deliveredRow
      ? { id: deliveredRow.badgeId, name: deliveredRow.badgeName, points: deliveredRow.points }
      : null;

    // Persist rank-tracking fields back into statsJson.
    // earnedBadgeIds is no longer stored here — the AchievementNotification table owns that.
    const cachedPoints = await prisma.studentPoints.findUnique({
      where: { studentId },
      select: { statsJson: true },
    });
    await prisma.studentPoints.update({
      where: { studentId },
      data: {
        statsJson: {
          ...(cachedPoints?.statsJson as object ?? {}),
          previousRank: rank,
          weeklyRankHistory: {
            ...weeklyRankHistory,
            ...(weeklyRankHistory[currentWeek] == null ? { [currentWeek]: rank } : {}),
          },
        },
      },
    });

    // ── 8. Daily challenges ───────────────────────────────────────────────
    //    "completed" = student actually did the thing today
    const todayStart = startOfDay();
    const todayEnd = new Date(todayStart.getTime() + 86_400_000);

    const todayScans = await prisma.offlineAttendanceRecord.findMany({
      where: { studentId, scannedAt: { gte: todayStart, lt: todayEnd } },
      select: { unitCode: true, lectureRoom: true, sessionStart: true, scannedAt: true },
    });
    const attendedToday = todayScans.length > 0;

    // "earlybird" challenge completed if any today scan qualifies early-bird
    let earlybirdToday = false;
    if (todayScans.length > 0) {
      const todayEarlyRows = await prisma.$queryRaw<[{ count: bigint }]>`
        WITH my_today AS (
          SELECT "unitCode", "lectureRoom", "sessionStart", "scannedAt"
          FROM "OfflineAttendanceRecord"
          WHERE "studentId" = ${studentId}
            AND "scannedAt" >= ${todayStart}
            AND "scannedAt" < ${todayEnd}
        ),
        session_stats AS (
          SELECT
            m."unitCode", m."lectureRoom", m."sessionStart",
            COUNT(a."id") as total,
            COUNT(a."id") FILTER (WHERE a."scannedAt" < m."scannedAt") as before_me
          FROM my_today m
          JOIN "OfflineAttendanceRecord" a
            ON a."unitCode" = m."unitCode"
            AND a."lectureRoom" = m."lectureRoom"
            AND a."sessionStart" = m."sessionStart"
          GROUP BY m."unitCode", m."lectureRoom", m."sessionStart", m."scannedAt"
        )
        SELECT COUNT(*)::int as count FROM session_stats
        WHERE (before_me + 1)::float / NULLIF(total, 0) <= 0.1
      `;
      earlybirdToday = Number(todayEarlyRows[0]?.count ?? 0) > 0;
    }

    // Check today's OnlineAttendanceRecord for on-time
    const ONTIME_MS = 5 * 60 * 1000;
    const todayOnlineScans = await prisma.onlineAttendanceRecord.findMany({
      where: { studentId, markedAt: { gte: todayStart, lt: todayEnd } },
      include: { session: { select: { createdAt: true } } },
    });
    const allOntimeToday =
      todayOnlineScans.length > 0 &&
      todayOnlineScans.every((r) => {
        const diff = r.markedAt.getTime() - r.session.createdAt.getTime();
        return diff >= 0 && diff <= ONTIME_MS;
      });

    // Points earned today
    const todayOntimeCount = todayOnlineScans.filter((r) => {
      const diff = r.markedAt.getTime() - r.session.createdAt.getTime();
      return diff >= 0 && diff <= ONTIME_MS;
    }).length;
    const pointsToday =
      todayScans.length * PTS.attend +
      todayOnlineScans.length * PTS.attend +
      todayOntimeCount * PTS.ontime +
      (earlybirdToday ? PTS.earlyBird : 0);

    const completedChallengeIds = new Set<string>();
    if (attendedToday) completedChallengeIds.add('unit_check');
    if (earlybirdToday) completedChallengeIds.add('earlybird');
    if (allOntimeToday) completedChallengeIds.add('ontime_all');

    const dailyChallenges = getDailyChallenges(completedChallengeIds);

    // ── 9. Weekly quests ──────────────────────────────────────────────────
    const weekStart = startOfWeek();
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);

    const weekScans = await prisma.offlineAttendanceRecord.findMany({
      where: { studentId, scannedAt: { gte: weekStart, lt: weekEnd } },
      select: { unitCode: true, lectureRoom: true, sessionStart: true, scannedAt: true },
    });

    // Days this week that have any attendance
    const weekDaysAttended = new Set(
      weekScans.map((s) => s.scannedAt.toISOString().slice(0, 10)),
    ).size;

    // On-time count this week (from OnlineAttendanceRecord)
    const weekOnlineScans = await prisma.onlineAttendanceRecord.findMany({
      where: { studentId, markedAt: { gte: weekStart, lt: weekEnd } },
      include: { session: { select: { createdAt: true } } },
    });
    const weekOntimeCount = weekOnlineScans.filter((r) => {
      const diff = r.markedAt.getTime() - r.session.createdAt.getTime();
      return diff >= 0 && diff <= ONTIME_MS;
    }).length;

    // Points trend: this week vs last week
    const lastWeekStart = new Date(weekStart.getTime() - 7 * 86_400_000);
    const [lastWeekOfflineCount, lastWeekOnlineCount] = await Promise.all([
      prisma.offlineAttendanceRecord.count({
        where: { studentId, scannedAt: { gte: lastWeekStart, lt: weekStart } },
      }),
      prisma.onlineAttendanceRecord.count({
        where: { studentId, markedAt: { gte: lastWeekStart, lt: weekStart } },
      }),
    ]);
    const thisWeekPts = weekScans.length * PTS.attend + weekOnlineScans.length * PTS.attend + weekOntimeCount * PTS.ontime;
    const lastWeekPts = (lastWeekOfflineCount + lastWeekOnlineCount) * PTS.attend;
    const pointsTrend = thisWeekPts - lastWeekPts;

    // Group leader count this week
    let weekGroupLeaderCount = 0;
    if (weekScans.length > 0) {
      const weekGLRows = await prisma.$queryRaw<[{ count: bigint }]>`
        WITH my_week AS (
          SELECT "unitCode", "lectureRoom", "sessionStart", "scannedAt"
          FROM "OfflineAttendanceRecord"
          WHERE "studentId" = ${studentId}
            AND "scannedAt" >= ${weekStart}
            AND "scannedAt" < ${weekEnd}
        ),
        my_group_mates AS (
          SELECT DISTINCT gm2."studentId"
          FROM "GroupMember" gm
          JOIN "GroupMember" gm2
            ON gm2."groupId" = gm."groupId"
            AND gm2."studentId" != ${studentId}
          WHERE gm."studentId" = ${studentId}
            AND gm."leftAt" IS NULL
            AND gm2."leftAt" IS NULL
        )
        SELECT COUNT(*)::int as count
        FROM my_week m
        WHERE NOT EXISTS (
          SELECT 1
          FROM "OfflineAttendanceRecord" other
          JOIN my_group_mates mgm ON mgm."studentId" = other."studentId"
          WHERE other."unitCode" = m."unitCode"
            AND other."lectureRoom" = m."lectureRoom"
            AND other."sessionStart" = m."sessionStart"
            AND other."scannedAt" < m."scannedAt"
        )
      `;
      weekGroupLeaderCount = Number(weekGLRows[0]?.count ?? 0);
    }

    const weeklyQuests = [
      {
        id: 'w1',
        name: 'Perfect Week',
        description: 'Attend all classes this week',
        progress: Math.min(weekDaysAttended, 5),
        target: 5,
        points: 100,
      },
      {
        id: 'w2',
        name: 'On-Time Streak',
        description: 'Check in on time 5 times this week',
        progress: Math.min(weekOntimeCount, 5),
        target: 5,
        points: 75,
      },
      {
        id: 'w3',
        name: 'Group Pioneer',
        description: 'Be first in your group 3 times this week',
        progress: Math.min(weekGroupLeaderCount, 3),
        target: 3,
        points: 60,
      },
    ];

    // ── 10. Build response ────────────────────────────────────────────────
    return NextResponse.json(
      {
        totalSessions: stats.totalSessions,
        attended: stats.attended,
        percent: stats.percent,
        currentStreak: stats.currentStreak,
        longestStreak: stats.longestStreak,
        perfectWeeks: stats.perfectWeeks,
        perfectMonths: stats.perfectMonths,
        ontimeCount: stats.ontimeCount,
        earlyBirdCount,
        comebacks: stats.comebacks,
        firstSessionDone: stats.firstSessionDone,
        unitsAbove90: stats.unitsAbove90,
        groupLeaderCount,
        rank: rank || totalStudents,
        totalStudents,
        rankTrend,
        weeklyRankChange,
        deptRank,
        deptTotal,
        rivalAbove,
        rivalBelow,
        points: augmentedTotal,
        pointsToday,
        pointsExpiring: 0,
        expiryDate: "",
        pointsTrend,
        ...(newlyUnlockedBadge ? { newlyUnlockedBadge } : {}),
        leaderboard,
        dailyChallenges,
        weeklyQuests,
      },
      { headers: corsHeaders },
    );
  } catch (err) {
    console.error('[achievements] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500, headers: corsHeaders });
  }
}
