function valueMillis(value) {
  if (value?.toDate) return value.toDate().getTime();
  if (!value) return null;
  const parsed = new Date(value).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function eventDateTime(event, useEnd = false) {
  if (!event?.date) return null;
  const time = useEnd ? (event.endTime || event.startTime || "23:59") : (event.startTime || "00:00");
  const parsed = new Date(`${event.date}T${time}:00`).getTime();
  return Number.isNaN(parsed) ? null : parsed;
}

function relevantTime(event, state) {
  if (state === "upcoming") return valueMillis(event.openAt) ?? eventDateTime(event) ?? Infinity;
  if (state === "open" || state === "full") return valueMillis(event.openAt) ?? eventDateTime(event);
  if (state === "closed") return valueMillis(event.closeAt) ?? eventDateTime(event, true) ?? -Infinity;
  return eventDateTime(event, true) ?? valueMillis(event.closeAt) ?? -Infinity;
}

export function compareStudentAllEvents(a, b, stateOf, now = Date.now()) {
  const stateA = stateOf(a);
  const stateB = stateOf(b);
  const rank = { upcoming: 0, open: 1, full: 1, closed: 2, ended: 2 };
  const byState = (rank[stateA] ?? 9) - (rank[stateB] ?? 9);
  if (byState) return byState;

  const timeA = relevantTime(a, stateA);
  const timeB = relevantTime(b, stateB);
  let byTime = 0;
  if (stateA === "upcoming") byTime = timeA - timeB;
  else if (stateA === "open" || stateA === "full") byTime = Math.abs(timeA - now) - Math.abs(timeB - now);
  else byTime = timeB - timeA;
  if (Number.isFinite(byTime) && byTime) return byTime;

  const byCreated = (valueMillis(b.createdAt) || 0) - (valueMillis(a.createdAt) || 0);
  return byCreated || String(a.id || "").localeCompare(String(b.id || ""));
}

export function matchesStudentGroupFilter(event, selectedGroupId) {
  if (!selectedGroupId) return true;
  if (selectedGroupId === "__ungrouped__") return !event.groupId;
  return event.groupId === selectedGroupId;
}
