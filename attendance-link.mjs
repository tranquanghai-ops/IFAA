export function activeAttendanceSessionForEvent(sessions, eventId) {
  if (!eventId || !Array.isArray(sessions)) return null;
  return sessions.find((item) => item?.eventId === eventId && !item.deletedAt) || null;
}
