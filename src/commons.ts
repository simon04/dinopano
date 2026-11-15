// Commons API access and the pure logic around it: parsing the file name from
// the URL, picking a resolution the GPU can handle, and the projection.

import type { PanoData } from "@photo-sphere-viewer/core";

export const COMMONS = "https://commons.wikimedia.org";
export const API = `${COMMONS}/w/api.php`;
/** formats that browsers decode and WebGL can use as a texture */
export const MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
/** texture width cap on touch devices, to stay within their GPU memory */
export const MOBILE_CAP = 8192;

/**
 * File name (without `File:` prefix, spaces instead of underscores) from
 * `#File_name.jpg`, `#File:File_name.jpg`, `?file=File_name.jpg` or a pasted
 * Commons URL; `undefined` if none is given.
 */
export function parseFileName(
  location: Pick<Location, "hash" | "search">,
): string | undefined {
  const raw =
    location.hash.replace(/^#/, "") ||
    new URLSearchParams(location.search).get("file") ||
    "";
  return normalizeFileName(raw);
}

/** Normalizes user input: decodes, strips URL and namespace prefixes. */
export function normalizeFileName(input: string): string | undefined {
  let name = input.trim();
  if (/^https?:\/\//i.test(name)) {
    // https://commons.wikimedia.org/wiki/File:X.jpg, …/w/index.php?title=File:X.jpg
    try {
      const url = new URL(name);
      name =
        url.searchParams.get("title") ??
        decodeURIComponent(url.pathname.replace(/^.*\/wiki\//, ""));
    } catch {
      // not a URL after all
    }
  } else {
    try {
      name = decodeURIComponent(name);
    } catch {
      // a literal `%` in the name, keep as is
    }
  }
  name = name
    .replace(/^(File|Image):/i, "")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return name || undefined;
}

/** `File_name.jpg`, as used in the hash and on Commons */
export function toHash(fileName: string): string {
  return encodeURIComponent(fileName.replace(/ /g, "_"))
    .replace(/%2C/g, ",")
    .replace(/%3A/g, ":")
    .replace(/%2F/g, "/")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")");
}

/** Largest texture width to request: the GPU limit, capped on touch devices. */
export function maxWidth(maxTextureSize: number, touch: boolean): number {
  return touch ? Math.min(maxTextureSize, MOBILE_CAP) : maxTextureSize;
}

/** `MAX_TEXTURE_SIZE` of WebGL from a throwaway context, 0 without WebGL. */
export function detectMaxTextureSize(): number {
  try {
    const canvas = document.createElement("canvas");
    const gl = canvas.getContext("webgl2") ?? canvas.getContext("webgl");
    if (!gl) return 0;
    const size = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    gl.getExtension("WEBGL_lose_context")?.loseContext();
    return size;
  } catch {
    return 0;
  }
}

export interface ImageInfo {
  title: string;
  width: number;
  height: number;
  size?: number;
  mime: string;
  url: string;
  thumburl?: string;
  thumbwidth?: number;
  descriptionurl: string;
  extmetadata?: Record<string, { value: string } | undefined>;
}

export function apiUrl(fileName: string, width: number): string {
  const params = new URLSearchParams({
    action: "query",
    format: "json",
    formatversion: "2",
    origin: "*",
    prop: "imageinfo",
    redirects: "1",
    titles: `File:${fileName}`,
    iiprop: "url|size|mime|extmetadata",
    iiextmetadatafilter: "Artist|LicenseShortName|LicenseUrl|ObjectName",
    iiurlwidth: String(width),
  });
  return `${API}?${params}`;
}

/** Thrown with a message meant for the user. */
export class UserError extends Error {}

/** Extracts the image info from an API response, or throws a `UserError`. */
export function parseResponse(json: unknown): ImageInfo {
  const data = json as {
    error?: { info?: string };
    query?: {
      pages?: {
        title: string;
        missing?: boolean;
        invalid?: boolean;
        invalidreason?: string;
        imageinfo?: Omit<ImageInfo, "title">[];
      }[];
    };
  };
  if (data.error) throw new UserError(`Commons API error: ${data.error.info}`);
  const page = data.query?.pages?.[0];
  if (!page) throw new UserError("Unexpected response from Commons.");
  if (page.invalid)
    throw new UserError(`Invalid file name: ${page.invalidreason ?? ""}`);
  const info = page.imageinfo?.[0];
  if (!info) throw new UserError(`File not found: ${page.title}`);
  if (!MIME_TYPES.includes(info.mime))
    throw new UserError(
      `Not an image: ${page.title} is ${info.mime}, only JPEG, PNG and WebP panoramas can be shown.`,
    );
  return { ...info, title: page.title };
}

export async function fetchImageInfo(
  fileName: string,
  width: number,
  signal?: AbortSignal,
): Promise<ImageInfo> {
  let response: Response;
  try {
    response = await fetch(apiUrl(fileName, width), { signal });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new UserError("Could not reach Wikimedia Commons.");
  }
  if (!response.ok)
    throw new UserError(`Commons API error: HTTP ${response.status}`);
  return parseResponse(await response.json());
}

export interface Source {
  /** image to show first */
  url: string;
  width: number;
  /** higher resolution to swap in once loaded, if any */
  fullUrl?: string;
}

/**
 * Picks the images to load: the original if the GPU can take it, else the
 * largest thumbnail the API offers. Originals larger than the thumbnail are
 * preceded by the thumbnail, so something is visible while they download.
 */
export function pickSource(info: ImageInfo, limit: number): Source {
  const thumb =
    info.thumburl && info.thumburl !== info.url
      ? { url: info.thumburl, width: thumbWidth(info) }
      : undefined;
  if (info.width <= limit) {
    return thumb && thumb.width < info.width
      ? { ...thumb, fullUrl: info.url }
      : { url: info.url, width: info.width };
  }
  return thumb ?? { url: info.url, width: info.width };
}

/**
 * Actual width of the thumbnail: the API reports the requested width in
 * `thumbwidth`, but serves only standard sizes, so read it from the URL.
 */
function thumbWidth(info: ImageInfo): number {
  const match = info.thumburl?.match(/\/(\d+)px-[^/]*$/);
  return match ? Number(match[1]) : (info.thumbwidth ?? info.width);
}

/** Whether the image is (close to) 2:1, a full sphere. */
export function isFullSphere(width: number, height: number): boolean {
  return Math.abs(width / height - 2) < 0.02;
}

/**
 * Projection of a partial panorama without XMP data: a full 360° horizontally,
 * centered vertically. Images wider than 2:1 cover less than 180° vertically,
 * narrower ones are assumed to cover the full width anyway.
 */
export function partialPanoData(width: number, height: number): PanoData {
  const fullHeight = Math.max(height, Math.round(width / 2));
  return {
    isEquirectangular: true,
    fullWidth: width,
    fullHeight,
    croppedWidth: width,
    croppedHeight: height,
    croppedX: 0,
    croppedY: Math.round((fullHeight - height) / 2),
  };
}

/** Plain text of an HTML snippet from extmetadata (e.g. Artist). */
export function htmlToText(html: string | undefined): string {
  if (!html) return "";
  const doc = new DOMParser().parseFromString(html, "text/html");
  return (doc.body.textContent ?? "").replace(/\s+/g, " ").trim();
}
