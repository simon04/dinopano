# dinopano

A slim, stable 360° panorama viewer for [Wikimedia Commons](https://commons.wikimedia.org/), at https://dinopano.toolforge.org/#File_name.jpg.

It runs entirely in the browser: no server-side code, database, cache or background jobs, so infrastructure changes on Toolforge can't break it. The URL format is the same as [Panoviewer](https://panoviewer.toolforge.org/)'s, so existing links (e.g. from `{{Pano360}}`) only need the host swapped. See [PLAN.md](PLAN.md) for the background.

## Features

- Open a panorama by URL: `#File_name.jpg`, `#File:File_name.jpg` or `?file=File_name.jpg`; a home page with an input box (file name or Commons URL) and examples
- File information from the Commons API (`prop=imageinfo`, CORS with `origin=*`), following redirects
- Resolution picked for the device: the original if it fits the GPU (`MAX_TEXTURE_SIZE`, capped at 8192 px on touch devices to save memory), else the largest thumbnail Commons serves (3840 px)
- Progressive loading: large originals show the thumbnail first, then swap in the original once downloaded, keeping the view
- Full spheres (2:1) and partial panoramas: GPano XMP data is used when the original is loaded, otherwise non-2:1 images are shown as 360° horizontally, centered vertically, with a notice
- Caption linked to the file page, author and license as an overlay
- Errors in plain language: file not found, not an image (only JPEG, PNG and WebP), image failed to load, no WebGL
- Zoom, move and fullscreen buttons, keyboard, mouse wheel and touch
- Dark mode for the home page (follows the system setting), [Codex](https://doc.wikimedia.org/codex/) design tokens
- No tracking: the only outside requests go to `commons.wikimedia.org` and `upload.wikimedia.org` / `thumb.wikimedia.org`

The viewer is [Photo Sphere Viewer](https://photo-sphere-viewer.js.org/) with [three.js](https://threejs.org/), bundled into the tool (Toolforge doesn't allow loading third-party resources such as public CDNs).

## Development

```sh
pnpm install   # also installs the Git pre-commit hook (vp config)
pnpm dev       # development server with hot reload
pnpm build     # type-check (tsc) and build to dist/
pnpm preview   # serve the production build from dist/
pnpm test      # unit tests (Vitest, happy-dom); also run in CI
pnpm vp check  # format, lint and type checks
pnpm vp fmt    # format all files
pnpm vp lint   # lint only
```

The logic is in [`src/commons.ts`](src/commons.ts) (parsing the file name, Commons API, resolution, projection; unit-tested in `src/commons.spec.ts`) and [`src/main.ts`](src/main.ts) (UI and viewer).

Tooling is [Vite+](https://viteplus.dev/) (`vp`), configured in `vite.config.ts` (`fmt`, `lint`, `staged`). The pre-commit hook (`.vite-hooks/`) runs `vp check --fix` on staged files, so commits are formatted and linted automatically.

CI builds on every push and deploys `master` to GitHub Pages (and Toolforge, if `TOOLFORGE_DEPLOY_TOKEN` is set).

## Deployment

The tool is deployed on [Toolforge](https://wikitech.wikimedia.org/wiki/Help:Toolforge/Deploy_your_tool)
at https://dinopano.toolforge.org/ using the build service. `toolforge.yaml`
declares a single continuous component, built from this repository and published
at `/`; the `web` process in the `Procfile` serves the Vite build output via
`server.js`.

Create the tool once at [toolsadmin](https://toolsadmin.wikimedia.org/) (Tools → Create new tool), register the configuration, then deploy:

```sh
ssh login.toolforge.org
become dinopano
toolforge components config create toolforge.yaml
toolforge components deployment create
```

Pushes to `master` deploy automatically once a deploy token
(`toolforge components deploy-token create`) is stored as the
`TOOLFORGE_DEPLOY_TOKEN` GitHub Actions secret.

The [Toolhub](https://toolhub.wikimedia.org/) record is served at https://dinopano.toolforge.org/toolinfo.json ([`public/toolinfo.json`](public/toolinfo.json)).

## License

[GPL-3.0](LICENSE) © Simon Legner. Photo Sphere Viewer and three.js are MIT licensed. Panoramas are shown with the author and license given on Commons.
