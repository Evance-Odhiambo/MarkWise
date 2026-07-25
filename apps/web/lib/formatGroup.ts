export function formatMember(m: any, leaderId: string | null) {
  const sName = m.student?.name ?? null;
  return {
    id: m.studentId,
    studentId: m.studentId,
    name: sName,
    studentName: sName,
    role: (m.role ?? (m.studentId === leaderId ? 'leader' : 'member')),
    admissionNumber: m.student?.admissionNumber ?? null,
    grade: m.student?.grade ?? null,
  };
}

export function formatGroup(group: any) {
  const unitCode = group.unitCode ?? group.unit?.code ?? null;
  const members = (group.members ?? []).map((m: any) => formatMember(m, group.leaderId));
  const leader = members.find((m: any) => m.role === 'leader') ?? null;

  return {
    id: group.id,
    _id: group.id,
    name: group.name,
    unitCode,
    courseCode: unitCode,
    groupNumber: group.groupNumber ?? 0,
    leaderId: group.leaderId ?? null,
    leaderName: leader?.name ?? null,
    leader: group.leaderId
      ? { id: group.leaderId, name: leader?.name ?? null }
      : null,
    capacity: group.capacity ?? 0,
    memberCount: (group.members ?? []).length,
    locked: group.locked ?? false,
    description: group.description ?? null,
    allowSelfEnroll: group.allowSelfEnroll ?? false,
    maxGroupsPerStudent: group.maxGroupsPerStudent ?? 1,
    nextMeeting: group.nextMeeting ? new Date(group.nextMeeting).toISOString() : null,
    tags: group.tags ?? [],
    members,
  };
}
