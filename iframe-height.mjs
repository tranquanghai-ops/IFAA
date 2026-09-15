const IFRAME_HEIGHT_MESSAGE = "IFAA_IFRAME_HEIGHT";
const DRUPAL_PARENT_ORIGIN = "https://ifa.tdtu.edu.vn";

if (window.parent !== window) {
  let lastHeight = 0;
  let pending = false;

  const getDocumentHeight = () => Math.ceil(Math.max(
    document.documentElement.scrollHeight,
    document.documentElement.offsetHeight,
    document.documentElement.clientHeight,
    document.body?.scrollHeight || 0,
    document.body?.offsetHeight || 0,
  ));

  const reportHeight = () => {
    pending = false;
    const height = getDocumentHeight();
    if (height === lastHeight) return;

    lastHeight = height;
    window.parent.postMessage({ type: IFRAME_HEIGHT_MESSAGE, height }, DRUPAL_PARENT_ORIGIN);
  };

  const scheduleReport = () => {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(reportHeight);
  };

  const resizeObserver = new ResizeObserver(scheduleReport);
  resizeObserver.observe(document.documentElement);
  if (document.body) resizeObserver.observe(document.body);

  const mutationObserver = new MutationObserver(scheduleReport);
  mutationObserver.observe(document.documentElement, { childList: true, subtree: true, attributes: true, characterData: true });

  window.addEventListener("resize", scheduleReport);
  window.addEventListener("load", scheduleReport, { once: true });
  scheduleReport();
}
