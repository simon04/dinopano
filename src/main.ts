import { events, Viewer, type PanoData } from "@photo-sphere-viewer/core";
import "@photo-sphere-viewer/core/index.css";
import "./style.css";
import {
  COMMONS,
  detectMaxTextureSize,
  fetchImageInfo,
  htmlToText,
  isFullSphere,
  maxWidth,
  normalizeFileName,
  parseFileName,
  partialPanoData,
  pickSource,
  toHash,
  UserError,
  type ImageInfo,
} from "./commons.ts";

const $ = <T extends HTMLElement>(id: string) =>
  document.getElementById(id) as T;
const container = $<HTMLDivElement>("viewer");
const help = $<HTMLElement>("help");
const message = $<HTMLDivElement>("message");
const attribution = $<HTMLDivElement>("attribution");
const status = $<HTMLDivElement>("status");
const form = $<HTMLFormElement>("open");
const input = $<HTMLInputElement>("file");

const touch = matchMedia("(pointer: coarse)").matches;
const maxTextureSize = detectMaxTextureSize();

let viewer: Viewer | undefined;
let controller: AbortController | undefined;

const version = $<HTMLSpanElement>("version");
if (import.meta.env.VITE_COMMIT_HASH) {
  version.textContent = ` · ${import.meta.env.VITE_COMMIT_HASH} (${import.meta.env.VITE_COMMIT_DATE})`;
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const name = normalizeFileName(input.value);
  if (name) location.hash = toHash(name);
});

window.addEventListener("hashchange", () => void show());
void show();

function reset(): void {
  controller?.abort();
  controller = new AbortController();
  viewer?.destroy();
  viewer = undefined;
  message.hidden = true;
  attribution.hidden = true;
  status.hidden = true;
  help.hidden = true;
}

async function show(): Promise<void> {
  reset();
  const { signal } = controller!;
  const fileName = parseFileName(location);
  if (!fileName) {
    document.title = "dinopano · 360° panorama viewer for Wikimedia Commons";
    help.hidden = false;
    input.focus();
    return;
  }
  document.title = `${fileName} · dinopano`;
  if (!maxTextureSize) {
    showMessage(
      "Your browser does not support WebGL, which is needed to show panoramas.",
    );
    return;
  }
  setStatus("Loading file information…");
  try {
    const info = await fetchImageInfo(
      fileName,
      maxWidth(maxTextureSize, touch),
      signal,
    );
    if (signal.aborted) return;
    document.title = `${info.title.replace(/^File:/, "")} · dinopano`;
    status.hidden = true;
    render(info, signal);
  } catch (error) {
    if (signal.aborted) return;
    showMessage(
      error instanceof UserError ? error.message : `Error: ${String(error)}`,
      fileName,
    );
  }
}

function render(info: ImageInfo, signal: AbortSignal): void {
  const source = pickSource(info, maxWidth(maxTextureSize, touch));
  const name = info.title.replace(/^File:/, "");
  // XMP (GPano) data is used if present, i.e. for originals; thumbnails have
  // it stripped, so partial panoramas fall back to a full 360° horizontally
  const panoData = (image: HTMLImageElement, xmpData?: PanoData) =>
    xmpData ?? partialPanoData(image.naturalWidth, image.naturalHeight);

  viewer = new Viewer({
    container,
    panorama: source.url,
    panoData,
    caption: `<a href="${escapeHtml(info.descriptionurl)}">${escapeHtml(name)}</a>`,
    navbar: ["zoom", "move", "caption", "fullscreen"],
    loadingTxt:
      source.url === info.url
        ? `Loading ${info.size ? formatSize(info.size) : "panorama"}…`
        : "Loading panorama…",
    touchmoveTwoFingers: false,
    mousewheelCtrlKey: false,
  });
  showAttribution(info);

  let swapping = false;
  viewer.addEventListener("panorama-error", () => {
    // a failing full resolution keeps the thumbnail, see loadFull()
    if (signal.aborted || swapping) return;
    showMessage(
      `The image failed to load: ${name}. It may be too large for this device.`,
      name,
    );
  });
  viewer.addEventListener(
    "panorama-loaded",
    () => {
      if (signal.aborted) return;
      if (!isFullSphere(info.width, info.height)) {
        viewer?.notification.show({
          content:
            "This image is not 2:1, so it is shown as a partial panorama covering 360° horizontally.",
          timeout: 6000,
        });
      }
      if (source.fullUrl) {
        swapping = true;
        void loadFull(source.fullUrl, info, signal);
      }
    },
    { once: true },
  );
}

/** Swaps in the original once downloaded, keeping the current view. */
async function loadFull(
  url: string,
  info: ImageInfo,
  signal: AbortSignal,
): Promise<void> {
  const v = viewer;
  if (!v) return;
  setStatus(`Loading full resolution (${formatSize(info.size)})…`);
  const onProgress = (event: events.LoadProgressEvent) => {
    if (!signal.aborted)
      setStatus(
        `Loading full resolution (${formatSize(info.size)}) ${Math.round(event.progress)} %`,
      );
  };
  v.addEventListener(events.LoadProgressEvent.type, onProgress);
  try {
    await v.setPanorama(url, {
      transition: false,
      showLoader: false,
      position: v.getPosition(),
      zoom: v.getZoomLevel(),
    });
    if (!signal.aborted) status.hidden = true;
  } catch (error) {
    if (signal.aborted) return;
    console.warn("Full resolution failed to load", error);
    setStatus("Full resolution failed to load, showing a smaller version.");
  } finally {
    v.removeEventListener(events.LoadProgressEvent.type, onProgress);
  }
}

function showAttribution(info: ImageInfo): void {
  const meta = info.extmetadata ?? {};
  const artist = htmlToText(meta.Artist?.value);
  const license = htmlToText(meta.LicenseShortName?.value);
  const licenseUrl = meta.LicenseUrl?.value;
  attribution.replaceChildren();
  if (artist) attribution.append(`© ${artist}`);
  if (license) {
    if (artist) attribution.append(", ");
    if (licenseUrl && /^https?:\/\//.test(licenseUrl)) {
      const a = document.createElement("a");
      a.href = licenseUrl;
      a.textContent = license;
      attribution.append(a);
    } else {
      attribution.append(license);
    }
  }
  attribution.hidden = !artist && !license;
}

function showMessage(text: string, fileName?: string): void {
  viewer?.destroy();
  viewer = undefined;
  status.hidden = true;
  attribution.hidden = true;
  message.replaceChildren();
  const p = document.createElement("p");
  p.textContent = text;
  message.append(p);
  const links = document.createElement("p");
  if (fileName) {
    const commons = document.createElement("a");
    commons.href = `${COMMONS}/wiki/File:${toHash(fileName)}`;
    commons.textContent = "Open on Commons";
    links.append(commons, " · ");
  }
  const home = document.createElement("a");
  home.href = "./";
  home.textContent = "Open another panorama";
  links.append(home);
  message.append(links);
  message.hidden = false;
}

function setStatus(text: string): void {
  status.textContent = text;
  status.hidden = false;
}

function formatSize(bytes: number | undefined): string {
  if (!bytes) return "?";
  return bytes >= 1e6
    ? `${(bytes / 1e6).toFixed(0)} MB`
    : `${Math.ceil(bytes / 1e3)} kB`;
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}
