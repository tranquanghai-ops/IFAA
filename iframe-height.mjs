const IFRAME_HEIGHT_MESSAGE = "IFAA_IFRAME_HEIGHT";
const DRUPAL_PARENT_ORIGIN = "https://ifa.tdtu.edu.vn";
const HEIGHT_BUFFER = 2;

if (window.parent !== window) {
  let lastHeight = 0;
  let pending = false;
  let settleTimer = 0;

  const getDocumentHeight = () => {
    const root = document.documentElement;
    const body = document.body;
    if (!body) return 0;

    const bodyRect = body.getBoundingClientRect();
    let contentBottom = bodyRect.top + window.scrollY + body.offsetHeight;

    for (const element of body.children) {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.position === "fixed") continue;
      const rect = element.getBoundingClientRect();
      const marginBottom = Number.parseFloat(style.marginBottom) || 0;
      contentBottom = Math.max(
        contentBottom,
        rect.bottom + window.scrollY + marginBottom,
        rect.top + window.scrollY + element.scrollHeight + marginBottom,
      );
    }

    const overflowingDocument = root.scrollHeight > root.clientHeight + 1 ? root.scrollHeight : 0;
    const overflowingBody = body.scrollHeight > root.clientHeight + 1 ? body.scrollHeight : 0;
    return Math.ceil(Math.max(contentBottom, overflowingDocument, overflowingBody)) + HEIGHT_BUFFER;
  };

  const reportHeight = () => {
    pending = false;
    const height = getDocumentHeight();
    if (height === lastHeight) return;

    lastHeight = height;
    window.parent.postMessage({ type: IFRAME_HEIGHT_MESSAGE, height }, DRUPAL_PARENT_ORIGIN);
  };

  const scheduleFrame = () => {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(() => window.requestAnimationFrame(reportHeight));
  };

  const scheduleReport = () => {
    scheduleFrame();
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(scheduleFrame, 120);
  };

  const resizeObserver = new ResizeObserver(scheduleReport);
  resizeObserver.observe(document.documentElement);
  if (document.body) resizeObserver.observe(document.body);

  const mutationObserver = new MutationObserver(scheduleReport);
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });

  window.addEventListener("resize", scheduleReport);
  window.addEventListener("orientationchange", scheduleReport);
  window.addEventListener("load", scheduleReport, { once: true });
  document.addEventListener("load", scheduleReport, true);
  document.addEventListener("loadedmetadata", scheduleReport, true);
  document.addEventListener("loadeddata", scheduleReport, true);
  document.fonts?.ready.then(scheduleReport);
  scheduleReport();
}
