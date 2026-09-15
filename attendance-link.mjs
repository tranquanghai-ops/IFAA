export function activeAttendanceSessionForEvent(sessions, eventId) {
  if (!eventId || !Array.isArray(sessions)) return null;
  return sessions.find((item) => item?.eventId === eventId && !item.deletedAt) || null;
}

export function activeAttendanceSessionById(sessions, sessionId) {
  if (!sessionId || !Array.isArray(sessions)) return null;
  return sessions.find((item) => item?.id === sessionId && !item.deletedAt) || null;
}
