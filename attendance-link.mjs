export function isActiveAttendanceSession(session) {
  return Boolean(session && !session.deletedAt);
}

export function activeAttendanceSessions(sessions) {
  return Array.isArray(sessions) ? sessions.filter(isActiveAttendanceSession) : [];
}

export function activeAttendanceSessionForEvent(sessions, eventId) {
  if (!eventId || !Array.isArray(sessions)) return null;
  return activeAttendanceSessions(sessions).find((item) => item.eventId === eventId) || null;
}

export function activeAttendanceSessionById(sessions, sessionId) {
  if (!sessionId || !Array.isArray(sessions)) return null;
  return activeAttendanceSessions(sessions).find((item) => item.id === sessionId) || null;
}
