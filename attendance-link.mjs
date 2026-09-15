export function isActiveAttendanceSession(session) {
  return Boolean(session && !session.deletedAt);
}

export function countdown(target) {
  const difference = Math.max(0, Number(target) - Date.now());
  const days = Math.floor(difference / 86400000);
  const totalHours = Math.floor(difference / 3600000);
  const remainingHours = totalHours % 24;
  const minutes = Math.floor((difference % 3600000) / 60000);
  const seconds = Math.floor((difference % 60000) / 1000);
  const clock = `${String(totalHours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  if (!days) return clock;
  const detail = [`${days} ngày`];
  if (remainingHours) detail.push(`${remainingHours} giờ`);
  if (minutes) detail.push(`${String(minutes).padStart(2, "0")} phút`);
  return `${clock} (${detail.join(" ")})`;
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
