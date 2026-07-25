/**
 * This backfill script is no longer needed — startMinute/endMinute now live on
 * SharedSession (not Timetable) following the schema redesign in May 2026.
 *
 * Kept as a stub to avoid breaking any CI scripts that reference it.
 */
async function main() {
  console.log("backfillTimetableMinutes: nothing to do (script obsolete after schema v2 migration).");
}

main()
  .then(() => process.exit(0))
  .catch((err) => { console.error(err); process.exit(1); });
