# Center Image Downloader — Chrome Extension

A lightweight Chrome (Manifest V3) extension that puts a **download button at the
center of every image** on a web page. Click an image's button to download that
image. There's also a green **Download all** button and **Activate / Deactivate**
controls to show or hide the buttons.

## Features

- A semi-transparent download button centered on every image — click it to save
  that image.
- Green **Download all** button (bottom-right) downloads every image on the page.
- **Activate / Deactivate** buttons toggle the visibility of all download buttons,
  so they never get in the way when you don't need them.
- Buttons follow images as you scroll and appear for images added later (SPAs,
  infinite scroll, lazy loading).
- Detects images in every common form: `<img>` tags, responsive
  `srcset`/`<picture>` images, **CSS `background-image`** elements (inline or
  class-based, e.g. Tinder photo cards), `role="img"` elements, `<video>`
  posters, and `blob:`/`data:` sources. Smart filenames derived from the URL.
- Skips page-wide background images so you never get a button stuck in the
  dead center of the whole page.
- Also works from the toolbar icon (triggers **Download all**).
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
| `content.js`    | Injects a button on each image + the Download all / Activate / Deactivate controls. |
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
