# Center Image Downloader — Chrome Extension

A lightweight Chrome (Manifest V3) extension that drops a floating **download
button in the center of every web page**. Click it and the extension downloads
the page's main image (the largest image it can find).

## Features

- Floating, semi-transparent download button centered on every page.
- One click downloads the largest image on the page.
- Works with `<img>` tags, responsive `srcset`/`<picture>` images, large CSS
  background images, and `blob:`/`data:` images.
- Smart filenames derived from the image URL.
- Also works from the toolbar icon (same "download main image" action).
- Self-contained UI rendered in a Shadow DOM, so page styles never break it.
- Minimal permissions: only `downloads`.

## Install (load unpacked)

1. Open `chrome://extensions` in Chrome (or any Chromium browser).
2. Enable **Developer mode** (top-right toggle).
3. Click **Load unpacked** and select this folder.
4. Open any web page — a blue download button appears in the center. Click it.

## How it works

| File            | Role                                                                    |
| --------------- | ----------------------------------------------------------------------- |
| `manifest.json` | MV3 manifest, permissions, and registration.                            |
| `content.js`    | Injects the centered button, finds the largest image, requests a save.  |
| `background.js` | Service worker that performs the download via the `chrome.downloads` API. |
| `icons/`        | Toolbar / store icons.                                                   |

The content script cannot call `chrome.downloads` directly, so it sends the
chosen image URL to the background service worker, which performs the actual
download.

## Notes

- The button does not appear on restricted pages such as `chrome://`,
  the Chrome Web Store, or other extensions' pages — browsers block content
  scripts there.
- If you reload the extension while a tab is open, refresh that tab before
  using the button again.
