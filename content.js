// Center Image Downloader — content script.
// Injects a floating download button into the center of the page. Clicking it
// finds the largest image on the page and downloads it.

(() => {
  "use strict";

  // Only run in the top frame and only once per document.
  if (window.top !== window.self) return;
  if (window.__centerImgDownloaderInjected) return;
  window.__centerImgDownloaderInjected = true;

  const DOWNLOAD_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path fill="none" stroke="currentColor" stroke-width="2"
            stroke-linecap="round" stroke-linejoin="round"
            d="M12 3v12m0 0l-5-5m5 5l5-5M5 21h14"/>
    </svg>`;

  const SPINNER_ICON = `
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor"
              stroke-width="2" stroke-linecap="round"
              stroke-dasharray="40 60"/>
    </svg>`;

  // ---- UI (isolated in a shadow root so page styles can't break it) ----
  const host = document.createElement("div");
  host.id = "__center-img-downloader-host";
  host.style.cssText = "all: initial; position: static; pointer-events: none;";
  const shadow = host.attachShadow({ mode: "open" });

  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      .cid-btn {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 60px;
        height: 60px;
        border: none;
        border-radius: 50%;
        background: #2563eb;
        color: #ffffff;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
        opacity: 0.4;
        pointer-events: auto;
        transition: opacity 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
        z-index: 2147483647;
      }
      .cid-btn:hover {
        opacity: 1;
        transform: translate(-50%, -50%) scale(1.08);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.45);
      }
      .cid-btn:active { transform: translate(-50%, -50%) scale(0.95); }
      .cid-btn svg { width: 28px; height: 28px; display: block; }
      .cid-btn.busy { pointer-events: none; opacity: 0.85; }
      .cid-btn.busy svg { animation: cid-spin 0.9s linear infinite; }
      @keyframes cid-spin { to { transform: rotate(360deg); } }

      .cid-toast {
        position: fixed;
        top: calc(50% + 52px);
        left: 50%;
        transform: translateX(-50%);
        background: rgba(17, 24, 39, 0.95);
        color: #ffffff;
        padding: 8px 14px;
        border-radius: 8px;
        font: 13px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif;
        white-space: nowrap;
        pointer-events: none;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.3);
        z-index: 2147483647;
        opacity: 0;
        transition: opacity 0.2s ease;
      }
      .cid-toast.show { opacity: 1; }
      .cid-toast.ok { background: rgba(5, 122, 85, 0.96); }
      .cid-toast.err { background: rgba(185, 28, 28, 0.96); }
    </style>
    <button class="cid-btn" type="button" title="Download the main image on this page">
      ${DOWNLOAD_ICON}
    </button>
    <div class="cid-toast" role="status"></div>
  `;

  (document.body || document.documentElement).appendChild(host);

  const btn = shadow.querySelector(".cid-btn");
  const toastEl = shadow.querySelector(".cid-toast");

  let toastTimer = null;
  function toast(message, kind) {
    toastEl.textContent = message;
    toastEl.className = "cid-toast show" + (kind ? " " + kind : "");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      toastEl.classList.remove("show");
    }, 2600);
  }

  // ---- Image discovery ----
  function bgImageUrl(value) {
    if (!value || value === "none") return null;
    const m = /url\((['"]?)(.*?)\1\)/i.exec(value);
    return m ? m[2] : null;
  }

  // Returns the source URL of the largest image on the page (or null).
  function findLargestImage() {
    let bestUrl = null;
    let bestArea = 0;

    // <img> elements (covers <picture> via currentSrc as well).
    for (const img of document.images) {
      const src = img.currentSrc || img.src;
      if (!src) continue;
      const rect = img.getBoundingClientRect();
      const natural = (img.naturalWidth || 0) * (img.naturalHeight || 0);
      const rendered = rect.width * rect.height;
      const area = Math.max(natural, rendered);
      if (area > bestArea) {
        bestArea = area;
        bestUrl = src;
      }
    }

    // Large CSS background images (hero banners, etc.).
    for (const el of document.querySelectorAll("*")) {
      const rect = el.getBoundingClientRect();
      const area = rect.width * rect.height;
      if (area <= bestArea || area < 40000) continue;
      const url = bgImageUrl(getComputedStyle(el).backgroundImage);
      if (url && /^(https?:|data:|blob:)/i.test(url)) {
        bestArea = area;
        bestUrl = url;
      }
    }

    return bestUrl;
  }

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
      if (!/\.(png|jpe?g|gif|webp|bmp|svg|avif|ico)$/i.test(name)) {
        name += ".jpg";
      }
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

  // The downloads API can take http(s)/data URLs directly. blob: URLs only
  // live in the page, so convert them to a data URL the worker can use.
  async function toDownloadableUrl(src) {
    if (src.startsWith("blob:")) {
      const resp = await fetch(src);
      const blob = await resp.blob();
      return blobToDataURL(blob);
    }
    return src;
  }

  // ---- Main action ----
  let busy = false;
  async function triggerDownload() {
    if (busy) return;
    const src = findLargestImage();
    if (!src) {
      toast("No image found on this page", "err");
      return;
    }

    busy = true;
    btn.classList.add("busy");
    btn.innerHTML = SPINNER_ICON;

    try {
      const url = await toDownloadableUrl(src);
      const filename = filenameFromUrl(src);
      const res = await chrome.runtime.sendMessage({
        type: "CID_DOWNLOAD",
        url,
        filename
      });
      if (res && res.ok) {
        toast("Image saved ✓", "ok");
      } else {
        toast("Download failed: " + ((res && res.error) || "unknown"), "err");
      }
    } catch (e) {
      const msg = String((e && e.message) || e);
      // Fired when the extension is reloaded while the page is open.
      if (/context invalidated/i.test(msg)) {
        toast("Reload this page to use the downloader", "err");
      } else {
        toast("Download failed", "err");
      }
    } finally {
      busy = false;
      btn.classList.remove("busy");
      btn.innerHTML = DOWNLOAD_ICON;
    }
  }

  btn.addEventListener("click", triggerDownload);

  // Allow the toolbar icon to trigger the same action.
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg && msg.type === "CID_TRIGGER") triggerDownload();
  });
})();
