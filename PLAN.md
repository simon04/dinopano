# dinopano — slim, stable 360° panorama viewer for Wikimedia Commons

**Goal:** A tiny, static Toolforge tool that displays equirectangular 360° photos from Commons, with no server-side code, database, cache or background jobs, so infrastructure changes can't break it. It's meant to replace Panoviewer as the target of `{{Pano360}}`.

**URL:** `https://dinopano.toolforge.org/#File_name.jpg`. This is the same hash format as Panoviewer, so existing links only need the host swapped.

> **Implementation note (v0.1):** following the setup of [DinoData](https://github.com/simon04/dinodata), dinopano is built with Vite+ and pnpm and deployed with the Toolforge build service (`toolforge.yaml`, `Procfile`, `server.js`) instead of `public_html` with an import map. Photo Sphere Viewer and three.js are npm dependencies bundled into the tool, so they are still served from Toolforge, not a CDN. License is GPL-3.0. See the [README](README.md) for development and deployment. Thumbnails turned out to be served only in standard widths (up to 3840 px), see §4.3.

---

## 1. Why a new tool

Panoviewer (`panoviewer.toolforge.org`) currently fails for new uploads with:

```
{"error": "Database error (found 0 results; should be 1)"}
```

The causes:

- It queries the `image` table on the wiki replicas. That table is being removed in favour of `file` / `filerevision` (T28741; Tech News 2026-17, deadline 28 May 2026).
- It connects to the outdated database host `commonswiki.labsdb`.
- It tiles large images (anything over 4,000 px wide, which includes every Insta360 X6 photo) with `jsub`, part of Toolforge's old GridEngine job system, which has been shut down.
- It requests thumbnails at a non-standard width (`w=4000`).
- It uses Pannellum, which gets little new development.

dinopano avoids all of these by running entirely in the browser.

## 2. Architecture

```
Browser
  │  1. read file name from location.hash
  │  2. GET commons.wikimedia.org/w/api.php  (imageinfo, origin=*)
  │  3. pick resolution ≤ WebGL MAX_TEXTURE_SIZE
  │  4. load image from upload.wikimedia.org (CORS-enabled)
  ▼
Photo Sphere Viewer (vendored) → WebGL sphere
```

- **Hosting:** static files in `~/public_html` behind the basic Toolforge webservice.
- **Dependencies at runtime:** only the Commons API and upload.wikimedia.org.
- **Libraries:** Photo Sphere Viewer 5.x (`@photo-sphere-viewer/core`, MIT) and three.js (MIT). Both are **vendored** into the tool, because Toolforge rules don't allow loading third-party resources such as public CDNs without the user's consent.
- **No build step:** use ES modules and an `<script type="importmap">` that points at the local files.

## 3. File layout

```
dinopano/
├── README.md
├── LICENSE                      # e.g. MIT
├── public_html/
│   ├── index.html               # markup, importmap, minimal CSS
│   ├── app.js                   # ~100–150 lines, all logic
│   ├── style.css                # optional
│   └── vendor/
│       ├── three/three.module.js
│       └── photo-sphere-viewer/
│           ├── index.module.js
│           └── index.css
└── scripts/
    └── update-vendor.sh         # fetch pinned versions via npm pack
```

## 4. Core logic (app.js)

1. **Parse input**
   - Accept `#File_name.jpg` (primary), `#File:File_name.jpg`, and `?file=File_name.jpg`.
   - Turn underscores into spaces and percent-decode the name.
   - Re-run on `hashchange`.
2. **Query the Commons API**
   ```
   https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2
     &origin=*&prop=imageinfo&titles=File:<name>
     &iiprop=url|size|mime|extmetadata
     &iiurlwidth=<W>
   ```
   - Handle missing pages, redirects (`redirects=1`) and deleted files.
   - Accept `image/jpeg`, `image/png` and `image/webp`.
3. **Pick resolution**
   - `maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE)`, from a throwaway WebGL context.
   - `W = min(originalWidth, maxTex, mobileCap)`, where `mobileCap` is about 8192 on touch devices to save memory.
   - If `W == originalWidth`, use the original `url`. Otherwise use the `thumburl` the API returns. Let the API decide which thumbnail widths are valid; don't hard-code them.
   - In practice Commons serves only standard thumbnail widths (largest 3840 px; others return HTTP 400), and `thumbwidth` reports the requested width, not the served one. So originals up to `W` are loaded after the 3840-px thumbnail (progressive loading, §9), larger ones get the thumbnail only.
4. **Projection**
   - 2:1 aspect ratio → full equirectangular sphere.
   - Not 2:1 → treat it as a partial panorama, computing PSV `panoData` from the GPano metadata if available, or else assuming a full 360° horizontal view. Show a small notice.
   - Thumbnails may have their XMP/GPano data stripped. That's fine for v1; v2 could read GPano from the API `metadata` instead.
5. **Render**
   - `new Viewer({ container, panorama: url, panoData, navbar: ['zoom','move','fullscreen','caption'] })`
   - Show a loading indicator while the image downloads. Big originals are 20–40 MB.
6. **UI chrome**
   - Caption: file title, linked to the Commons file page.
   - Attribution: author and license from `extmetadata` (Artist, LicenseShortName), shown as a small overlay.
   - Errors in plain language: "File not found", "Not an image", "Image failed to load".
   - Empty hash → a short help page with an input box and an example link.

## 5. Explicit non-goals for v1

- No server-side code, database access, caching or tiling.
- No analytics or tracking. The only outside requests go to Wikimedia domains.
- No video and no 360° stereo.
- No hotspots or virtual tours.

## 6. Setup on Toolforge

1. Create the tool **dinopano** at <https://toolsadmin.wikimedia.org> → Tools → Create new tool.
2. SSH in and become the tool:
   ```bash
   ssh login.toolforge.org
   become dinopano
   ```
3. Clone the repository and link or copy `public_html`:
   ```bash
   git clone https://gitlab.wikimedia.org/<you>/dinopano.git ~/src
   ln -s ~/src/public_html ~/public_html
   ```
4. Start the webservice. Any type that serves `public_html` statically works; check what's available with `toolforge webservice --help` or `webservice --help`:
   ```bash
   toolforge webservice php8.2 start   # or the current recommended version
   ```
5. Deploy updates with `cd ~/src && git pull`. A static change needs no restart.
6. Add a Toolhub record / `toolinfo.json` with the name, description, source URL, license and maintainer.

## 7. Testing checklist

- [ ] `#Salzburg_Hauptbahnhof_(IMG_20261111_091358_00_141).jpg`: X6 photo, large, uploaded recently
- [ ] An old, well-known panorama from Category:Spherical panoramics
- [ ] A small panorama (< 4000 px) loads the original directly
- [ ] A file name with parentheses, umlauts, spaces and `&`
- [ ] `File:` prefix and `?file=` variants
- [ ] A non-2:1 image shows the partial-pano notice
- [ ] A missing file gives a clear error
- [ ] A non-image file (PDF, video) gives a clear error
- [ ] Mobile: Android Chrome and iOS Safari (texture limit, touch, gyroscope if enabled)
- [ ] Desktop: Firefox and Chrome, fullscreen
- [ ] DevTools network tab shows requests only to `*.wikimedia.org` and `dinopano.toolforge.org`

## 8. Rollout

1. **v0.1:** static viewer working for the test list above.
2. **Announce** at Commons:Village pump/Technical. Mention the Panoviewer breakage and its Phabricator task.
3. **Switch `{{Pano360}}`** (and `{{PanoViewer}}` on Wikipedias) from `panoviewer.toolforge.org` to `dinopano.toolforge.org` after a short discussion, or offer dinopano as a parameter or fallback first.
4. **Leave a note** on Panoviewer's Phabricator task and Tool page that a static alternative exists.

## 9. Possible v2 ideas

- **GPano from the API:** read XMP from `prop=imageinfo&iiprop=metadata` so the initial heading, pitch and cropped panos are correct even with thumbnails.
- **Progressive loading:** show a 1920-px thumbnail instantly, then swap in the high-resolution one.
- **Gyroscope:** device orientation via the PSV Gyroscope plugin, opt-in.
- **Deep links to a view:** `#File.jpg&yaw=…&pitch=…&zoom=…`.
- **Little planet / stereographic mode:** PSV supports it with a config change.
- **Client-side tiling:** cut the original into tiles in a Web Worker with OffscreenCanvas for full resolution on desktops, or use the PSV equirectangular-tiles adapter if a tile source ever exists.
- **i18n:** a few UI strings, using the `uselang` parameter.

## 10. Effort estimate

| Task                                     | Time                 |
| ---------------------------------------- | -------------------- |
| Vendor libraries, importmap, skeleton    | 0.5 h                |
| API query, resolution picking, rendering | 1–2 h                |
| Errors, attribution, help page           | 1 h                  |
| Toolforge setup and deploy               | 0.5 h                |
| Testing (desktop and mobile)             | 1 h                  |
| **Total for v0.1**                       | **about half a day** |

## References

- Tech News 2026-17: image/oldimage removal from wiki replicas: <https://diff.wikimedia.org/2026/04/20/tech-news-2026-issue-17/>
- Manual:file table: <https://www.mediawiki.org/wiki/Manual:File_table>
- Panoviewer source: <https://github.com/toollabs/panoviewer>
- Tool:Panoviewer: <https://wikitech.wikimedia.org/wiki/Tool:Panoviewer>
- TheDJ's PanoViewer extension notes: <https://www.mediawiki.org/wiki/User:TheDJ/panoviewer>
- Photo Sphere Viewer: <https://photo-sphere-viewer.js.org/>
- MediaWiki Action API, imageinfo: <https://www.mediawiki.org/wiki/API:Imageinfo>
