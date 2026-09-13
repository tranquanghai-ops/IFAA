(() => {
  const FIREBASE_CHECKIN_URL = "https://ifa-activities.web.app/check-in/";
  const sessionId = new URLSearchParams(window.location.search).get("e")?.trim().toUpperCase() || "";
  const container = document.getElementById("ifaa-checkin-embed");
  let frame = container?.querySelector("iframe") || document.querySelector('iframe[src*="ifa-activities.web.app/check-in"]');

  if (!frame && container) {
    frame = document.createElement("iframe");
    frame.title = "Điểm danh sự kiện IFA+A";
    frame.allow = "camera; microphone; clipboard-write";
    frame.style.cssText = "display:block;width:100%;min-height:100vh;border:0";
    container.appendChild(frame);
  }
  if (!frame) return;

  const target = new URL(FIREBASE_CHECKIN_URL);
  if (sessionId) target.searchParams.set("e", sessionId);
  if (frame.src !== target.toString()) frame.src = target.toString();

  window.addEventListener("message", (event) => {
    if (event.origin !== "https://ifa-activities.web.app" || event.data?.type !== "ifaa-checkin-ready") return;
    event.source?.postMessage({ type: "ifaa-checkin-session", sessionId }, event.origin);
  });
})();
