export function creatorLabel(resource) {
  const name = typeof resource?.createdByName === "string" ? resource.createdByName.trim() : "";
  const email = typeof resource?.createdByEmail === "string" ? resource.createdByEmail.trim() : "";
  return name || email || "—";
}

export function isGroupHidden(group) {
  return group?.hidden === true || Boolean(group?.hiddenAt);
}

export function groupsForVisibility(groups, visibility = "active") {
  return groups.filter((group) => visibility === "hidden" ? isGroupHidden(group) : !isGroupHidden(group));
}

export function eventsVisibleInAdmin(events, groups) {
  const hiddenGroupIds = new Set(groups.filter(isGroupHidden).map((group) => group.id));
  return events.filter((event) => !event.groupId || !hiddenGroupIds.has(event.groupId));
}
