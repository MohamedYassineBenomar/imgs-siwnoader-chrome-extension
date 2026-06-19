// Center Image Downloader — content script.
// Puts a download button at the center of every image. Clicking a button
// downloads that image. Also adds a green "Download all" button and
// Activate/Deactivate controls that toggle the visibility of all buttons.

(() => {
  "use strict";

  // Only run in the top frame and only once per document.
  if (window.top !== window.self) return;
  if (window.__centerImgDownloaderInjected) return;
  window.__centerImgDownloaderInjected = true;

  const MIN_SIZE = 48; // ignore images smaller than this (icons, tracking pixels)

  const DOWNLOAD_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"
            d="M12 3v12m0 0l-5-5m5 5l5-5M5 21h14"/>
    </svg>`;

  // ---- UI (isolated in a shadow root so page styles can't break it) ----
  const host = document.createElement("div");
  host.id = "__center-img-downloader-host";
  host.style.cssText = "all: initial; position: static; pointer-events: none;";
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }

      .cid-overlay { position: fixed; inset: 0; pointer-events: none; overflow: visible; z-index: 2147483646; }

      .cid-imgbtn {
        position: absolute;
        width: 42px; height: 42px;
        transform: translate(-50%, -50%);
        border: 2px solid rgba(255, 255, 255, 0.9); border-radius: 50%;
        background: #2563eb; color: #fff;
        box-sizing: border-box;
        cursor: pointer;
        display: none;
        align-items: center; justify-content: center;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.5);
        opacity: 0.75;
        pointer-events: auto;
        transition: opacity 0.15s ease, transform 0.12s ease;
        z-index: 2147483646;
      }
      .cid-imgbtn:hover { opacity: 1; transform: translate(-50%, -50%) scale(1.12); }
      .cid-imgbtn:active { transform: translate(-50%, -50%) scale(0.92); }
      .cid-imgbtn svg { width: 21px; height: 21px; display: block; }
      .cid-imgbtn.busy { pointer-events: none; opacity: 0.85; }
      .cid-imgbtn.busy svg { animation: cid-spin 0.9s linear infinite; }
      @keyframes cid-spin { to { transform: rotate(360deg); } }

      .cid-panel {
        position: fixed; right: 16px; bottom: 16px;
        display: flex; flex-direction: column; gap: 8px; align-items: stretch;
        pointer-events: auto; z-index: 2147483647;
        font: 600 13px/1 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
      }
      .cid-all {
        display: flex; align-items: center; justify-content: center; gap: 8px;
        background: #16a34a; color: #fff;
        border: none; border-radius: 10px; padding: 11px 16px;
        cursor: pointer; box-shadow: 0 6px 18px rgba(0, 0, 0, 0.3);
        transition: background 0.15s ease, transform 0.1s ease;
      }
      .cid-all:hover { background: #15803d; }
      .cid-all:active { transform: scale(0.97); }
      .cid-all svg { width: 18px; height: 18px; display: block; }
      .cid-all[hidden] { display: none; }

      .cid-toggle { display: flex; gap: 6px; }
      .cid-toggle button {
        flex: 1; border: none; border-radius: 8px; padding: 8px 10px;
        color: #fff; cursor: pointer; font: inherit;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.22);
        transition: background 0.15s ease, transform 0.1s ease;
      }
      .cid-toggle button:active { transform: scale(0.96); }
      .cid-on { background: #2563eb; }
      .cid-on:hover { background: #1d4ed8; }
      .cid-off { background: #6b7280; }
      .cid-off:hover { background: #4b5563; }
      .cid-on.current { outline: 2px solid #bfdbfe; outline-offset: 1px; }
      .cid-off.current { outline: 2px solid #d1d5db; outline-offset: 1px; }

      .cid-toast {
        position: fixed; left: 50%; bottom: 86px; transform: translateX(-50%);
        background: rgba(17, 24, 39, 0.95); color: #fff;
        padding: 8px 14px; border-radius: 8px; white-space: nowrap;
        font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        pointer-events: none; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
        z-index: 2147483647; opacity: 0; transition: opacity 0.2s ease;
      }
      .cid-toast.show { opacity: 1; }
      .cid-toast.ok { background: rgba(5, 122, 85, 0.96); }
      .cid-toast.err { background: rgba(185, 28, 28, 0.96); }
    </style>
    <div class="cid-overlay"></div>
    <div class="cid-panel">
      <button class="cid-all" type="button" title="Download every image on this page">
        ${DOWNLOAD_ICON}<span>Download all</span>
      </button>
      <div class="cid-toggle">
        <button class="cid-on" type="button" title="Show the download buttons">Activate</button>
        <button class="cid-off" type="button" title="Hide the download buttons">Deactivate</button>
      </div>
    </div>
    <div class="cid-toast" role="status"></div>
  `;

  (document.body || document.documentElement).appendChild(host);

  const overlay = shadow.querySelector(".cid-overlay");
  const allBtn = shadow.querySelector(".cid-all");
  const onBtn = shadow.querySelector(".cid-on");
  const offBtn = shadow.querySelector(".cid-off");
  const toastEl = shadow.querySelector(".cid-toast");

  // ---- Toast ----
  let toastTimer = null;
  function toast(message, kind) {
    toastEl.textContent = message;
    toastEl.className = "cid-toast show" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2600);
  }

  // ---- Download helpers ----
  function filenameFromUrl(url) {
    try {
      if (url.startsWith("data:")) {
        const m = /^data:image\/([\w.+-]+)/i.exec(url);
        const ext = (m ? m[1] : "png").replace(/[^\w]/g, "") || "png";
        return `image-${Date.now()}.${ext}`;
      }
      const u = new URL(url, location.href);
      let name = decodeURIComponent((u.pathname.split("/").pop() || "").trim());
      name = name.split("?")[0];
      if (!name) name = "image";
      if (!/\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(name)) name += ".jpg";
      return name.replace(/[\\/:*?"<>|]+/g, "_").slice(0, 120);
    } catch {
      return `image-${Date.now()}.jpg`;
    }
  }

  function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  // The downloads API accepts http(s)/data URLs directly. blob: URLs only live
  // in the page, so convert them to a data URL the service worker can use.
  async function toDownloadableUrl(src) {
    if (src.startsWith("blob:")) {
      const resp = await fetch(src);
      const blob = await resp.blob();
      return blobToDataURL(blob);
    }
    return src;
  }

  async function download(src) {
    const url = await toDownloadableUrl(src);
    const res = await chrome.runtime.sendMessage({
      type: "CID_DOWNLOAD",
      url,
      filename: filenameFromUrl(src)
    });
    if (!res || !res.ok) throw new Error((res && res.error) || "unknown");
  }

  async function downloadOne(src, btn) {
    if (!src || (btn && btn.classList.contains("busy"))) return;
    if (btn) btn.classList.add("busy");
    try {
      await download(src);
      toast("Image saved ✓", "ok");
    } catch (e) {
      const msg = String((e && e.message) || e);
      if (/context invalidated/i.test(msg)) {
        toast("Reload this page to use the downloader", "err");
      } else {
        toast("Download failed: " + msg, "err");
      }
    } finally {
      if (btn) btn.classList.remove("busy");
    }
  }

  function eligibleSources() {
    const sources = [];
    const seen = new Set();
    for (const img of document.images) {
      const src = img.currentSrc || img.src;
      if (!src || seen.has(src)) continue;
      const rect = img.getBoundingClientRect();
      const bigEnough =
        (img.naturalWidth >= 32 && img.naturalHeight >= 32) ||
        Math.max(rect.width, rect.height) >= MIN_SIZE;
      if (!bigEnough) continue;
      seen.add(src);
      sources.push(src);
    }
    return sources;
  }

  let downloadingAll = false;
  async function downloadAll() {
    if (downloadingAll) return;
    const sources = eligibleSources();
    if (!sources.length) {
      toast("No images to download", "err");
      return;
    }
    downloadingAll = true;
    allBtn.disabled = true;
    toast(`Downloading ${sources.length} image${sources.length > 1 ? "s" : ""}…`);
    let ok = 0;
    let fail = 0;
    for (const src of sources) {
      try {
        await download(src);
        ok++;
      } catch {
        fail++;
      }
    }
    downloadingAll = false;
    allBtn.disabled = false;
    toast(
      `Saved ${ok} image${ok !== 1 ? "s" : ""}` + (fail ? `, ${fail} failed` : ""),
      fail ? "err" : "ok"
    );
  }

  // ---- Per-image buttons ----
  const tracked = new Map(); // img element -> button element

  function addButton(img) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "cid-imgbtn";
    btn.title = "Download this image";
    btn.innerHTML = DOWNLOAD_ICON;
    btn.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      downloadOne(img.currentSrc || img.src, btn);
    });
    overlay.appendChild(btn);
    tracked.set(img, btn);
  }

  function removeButton(img) {
    const btn = tracked.get(img);
    if (btn) btn.remove();
    tracked.delete(img);
  }

  function refreshImages() {
    const present = new Set();
    for (const img of document.images) {
      present.add(img);
      if (!tracked.has(img)) addButton(img);
    }
    for (const img of [...tracked.keys()]) {
      if (!present.has(img)) removeButton(img);
    }
    reposition();
  }

  let active = true;
  function reposition() {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    // The buttons are absolutely positioned inside the overlay. If a page
    // ancestor has a transform/filter, the overlay's fixed box may be offset
    // from the viewport, so subtract its own position to land buttons exactly
    // over each image regardless of the containing block.
    const base = overlay.getBoundingClientRect();
    for (const [img, btn] of tracked) {
      const r = img.getBoundingClientRect();
      const visible =
        active &&
        Math.max(r.width, r.height) >= MIN_SIZE &&
        r.bottom > 0 && r.right > 0 && r.top < vh && r.left < vw;
      if (!visible) {
        btn.style.display = "none";
        continue;
      }
      btn.style.display = "flex";
      btn.style.left = r.left + r.width / 2 - base.left + "px";
      btn.style.top = r.top + r.height / 2 - base.top + "px";
    }
  }

  function setActive(value) {
    active = value;
    onBtn.classList.toggle("current", active);
    offBtn.classList.toggle("current", !active);
    allBtn.hidden = !active;
    reposition();
  }

  // ---- Wiring ----
  allBtn.addEventListener("click", downloadAll);
  onBtn.addEventListener("click", () => setActive(true));
  offBtn.addEventListener("click", () => setActive(false));

  let rafPending = false;
  function scheduleReposition() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      reposition();
    });
  }

  let refreshPending = false;
  function scheduleRefresh() {
    if (refreshPending) return;
    refreshPending = true;
    requestAnimationFrame(() => {
      refreshPending = false;
      refreshImages();
    });
  }

  window.addEventListener("scroll", scheduleReposition, { passive: true, capture: true });
  window.addEventListener("resize", scheduleReposition);
  window.addEventListener("load", scheduleRefresh);
  document.addEventListener("load", scheduleReposition, true); // image finished loading
  new MutationObserver(scheduleRefresh).observe(document.documentElement, {
    childList: true,
    subtree: true
  });
  setInterval(refreshImages, 700); // catch SPA navigation / layout shifts

  setActive(true);
  refreshImages();
  // Re-run a few times early on to catch images that size up after first paint.
  [150, 500, 1200, 2500].forEach((delay) => setTimeout(refreshImages, delay));

  // Toolbar icon triggers "Download all".
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "CID_TRIGGER") downloadAll();
  });
})();
