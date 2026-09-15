const IFRAME_HEIGHT_MESSAGE = "IFAA_IFRAME_HEIGHT";
const DRUPAL_PARENT_ORIGIN = "https://ifa.tdtu.edu.vn";
const HEIGHT_BUFFER = 2;
const LARGE_DECREASE_RATIO = 0.7;
const DECREASE_CONFIRM_MS = 500;
const CONTENT_ROOT_SELECTOR = "main, #studentApp, #eventArea, #eventGrid, #adminApp, .pane:not(.hidden), #app, #scannerArea, #rows";

if (window.parent !== window) {
  let lastHeight = 0;
  let pending = false;
  let settleTimer = 0;
  let decreaseTimer = 0;
  let decreaseCandidate = 0;
  let decreaseCandidateAt = 0;
  let decreaseSamples = 0;

  const getDocumentHeight = () => {
    const root = document.documentElement;
    const body = document.body;
    if (!body) return 0;

    const bodyRect = body.getBoundingClientRect();
    let contentBottom = bodyRect.top + window.scrollY + body.offsetHeight;

    const contentRoots = new Set([...body.children, ...document.querySelectorAll(CONTENT_ROOT_SELECTOR)]);
    for (const element of contentRoots) {
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
    if (!height) return;

    const baseline = lastHeight || Math.ceil(document.documentElement.clientHeight);
    const largeDecrease = baseline > 0 && height < baseline * LARGE_DECREASE_RATIO;
    if (largeDecrease) {
      const now = performance.now();
      if (Math.abs(height - decreaseCandidate) > HEIGHT_BUFFER) {
        decreaseCandidate = height;
        decreaseCandidateAt = now;
        decreaseSamples = 1;
      } else {
        decreaseSamples += 1;
      }

      const remaining = DECREASE_CONFIRM_MS - (now - decreaseCandidateAt);
      if (decreaseSamples < 2 || remaining > 0) {
        window.clearTimeout(decreaseTimer);
        decreaseTimer = window.setTimeout(scheduleFrame, Math.max(remaining, 0));
        return;
      }
    }

    window.clearTimeout(decreaseTimer);
    decreaseCandidate = 0;
    decreaseCandidateAt = 0;
    decreaseSamples = 0;
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
