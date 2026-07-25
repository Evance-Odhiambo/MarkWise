// Audit Log API utility
export function writeAuditLog({ action, actor, target, details } = {}) {
  // Silently fire-and-forget until backend audit log is wired
  return Promise.resolve();
}
