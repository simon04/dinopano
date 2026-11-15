import { describe, expect, it } from "vite-plus/test";
import {
  apiUrl,
  htmlToText,
  isFullSphere,
  maxWidth,
  normalizeFileName,
  parseFileName,
  parseResponse,
  partialPanoData,
  pickSource,
  toHash,
  UserError,
  type ImageInfo,
} from "./commons.ts";

const loc = (hash: string, search = "") => ({ hash, search });

describe("parseFileName", () => {
  it("reads the hash", () => {
    expect(parseFileName(loc("#Salzburg_Hauptbahnhof_(IMG_1).jpg"))).toBe(
      "Salzburg Hauptbahnhof (IMG 1).jpg",
    );
  });
  it("strips the File: prefix", () => {
    expect(parseFileName(loc("#File:A_b.jpg"))).toBe("A b.jpg");
    expect(parseFileName(loc("#image:A_b.jpg"))).toBe("A b.jpg");
  });
  it("percent-decodes", () => {
    expect(parseFileName(loc("#M%C3%BCnchen_%26_Umgebung.jpg"))).toBe(
      "München & Umgebung.jpg",
    );
    expect(parseFileName(loc("#100%_sure.jpg"))).toBe("100% sure.jpg");
  });
  it("reads ?file=", () => {
    expect(parseFileName(loc("", "?file=A_%26_B.jpg"))).toBe("A & B.jpg");
    expect(parseFileName(loc("", "?file=File:A+B.jpg"))).toBe("A B.jpg");
  });
  it("prefers the hash", () => {
    expect(parseFileName(loc("#A.jpg", "?file=B.jpg"))).toBe("A.jpg");
  });
  it("is undefined without a name", () => {
    expect(parseFileName(loc(""))).toBeUndefined();
    expect(parseFileName(loc("#"))).toBeUndefined();
    expect(parseFileName(loc("#File:"))).toBeUndefined();
  });
});

describe("normalizeFileName", () => {
  it("accepts Commons URLs", () => {
    expect(
      normalizeFileName(
        "https://commons.wikimedia.org/wiki/File:M%C3%BCnchen_(Nord).jpg",
      ),
    ).toBe("München (Nord).jpg");
    expect(
      normalizeFileName(
        "https://commons.wikimedia.org/w/index.php?title=File:A_b.jpg&oldid=1",
      ),
    ).toBe("A b.jpg");
    expect(
      normalizeFileName("https://commons.m.wikimedia.org/wiki/File:A.jpg#x"),
    ).toBe("A.jpg");
  });
  it("trims whitespace", () => {
    expect(normalizeFileName("  File:A  b.jpg ")).toBe("A b.jpg");
  });
});

describe("toHash", () => {
  it("round-trips", () => {
    for (const name of [
      "München & Umgebung (1).jpg",
      "A, B: C.jpg",
      "a#b?.jpg",
    ])
      expect(parseFileName(loc(`#${toHash(name)}`))).toBe(name);
  });
  it("keeps it readable", () => {
    expect(toHash("Salzburg Hbf (1).jpg")).toBe("Salzburg_Hbf_(1).jpg");
  });
});

describe("apiUrl", () => {
  it("queries imageinfo", () => {
    const url = new URL(apiUrl("A & B.jpg", 8192));
    expect(url.origin).toBe("https://commons.wikimedia.org");
    expect(url.searchParams.get("titles")).toBe("File:A & B.jpg");
    expect(url.searchParams.get("iiurlwidth")).toBe("8192");
    expect(url.searchParams.get("origin")).toBe("*");
    expect(url.searchParams.get("redirects")).toBe("1");
  });
});

describe("maxWidth", () => {
  it("caps touch devices", () => {
    expect(maxWidth(16384, false)).toBe(16384);
    expect(maxWidth(16384, true)).toBe(8192);
    expect(maxWidth(4096, true)).toBe(4096);
  });
});

const info = (width: number, height = width / 2): ImageInfo => ({
  title: "File:A.jpg",
  width,
  height,
  mime: "image/jpeg",
  url: "https://upload.wikimedia.org/wikipedia/commons/a/ab/A.jpg",
  thumburl:
    width > 3840
      ? "https://upload.wikimedia.org/wikipedia/commons/thumb/a/ab/A.jpg/3840px-A.jpg"
      : "https://upload.wikimedia.org/wikipedia/commons/a/ab/A.jpg",
  thumbwidth: 8192,
  descriptionurl: "https://commons.wikimedia.org/wiki/File:A.jpg",
});

describe("pickSource", () => {
  it("loads small originals directly", () => {
    expect(pickSource(info(3000), 16384)).toEqual({
      url: info(3000).url,
      width: 3000,
    });
  });
  it("shows the thumbnail first, then the original", () => {
    expect(pickSource(info(15520), 16384)).toEqual({
      url: info(15520).thumburl,
      width: 3840,
      fullUrl: info(15520).url,
    });
  });
  it("uses the thumbnail if the original is too large", () => {
    expect(pickSource(info(15520), 8192)).toEqual({
      url: info(15520).thumburl,
      width: 3840,
    });
  });
});

describe("parseResponse", () => {
  const page = (extra: object) => ({
    query: { pages: [{ title: "File:A.jpg", ...extra }] },
  });
  it("returns the image info", () => {
    const { title: _, ...ii } = info(4000);
    expect(parseResponse(page({ imageinfo: [ii] }))).toEqual(info(4000));
  });
  it("reports missing files", () => {
    expect(() => parseResponse(page({ missing: true }))).toThrow(
      new UserError("File not found: File:A.jpg"),
    );
  });
  it("reports invalid names", () => {
    expect(() =>
      parseResponse(page({ invalid: true, invalidreason: "bad" })),
    ).toThrow(/Invalid file name/);
  });
  it("reports non-images", () => {
    const ii = { ...info(4000), mime: "application/pdf" };
    expect(() => parseResponse(page({ imageinfo: [ii] }))).toThrow(
      /Not an image/,
    );
  });
  it("reports API errors", () => {
    expect(() => parseResponse({ error: { info: "boom" } })).toThrow(/boom/);
  });
});

describe("projection", () => {
  it("detects full spheres", () => {
    expect(isFullSphere(15520, 7760)).toBe(true);
    expect(isFullSphere(15349, 5801)).toBe(false);
  });
  it("centers partial panoramas vertically", () => {
    expect(partialPanoData(4000, 1000)).toEqual({
      isEquirectangular: true,
      fullWidth: 4000,
      fullHeight: 2000,
      croppedWidth: 4000,
      croppedHeight: 1000,
      croppedX: 0,
      croppedY: 500,
    });
  });
  it("keeps full spheres as they are", () => {
    expect(partialPanoData(4000, 2000)).toMatchObject({
      fullHeight: 2000,
      croppedY: 0,
    });
  });
});

describe("htmlToText", () => {
  it("strips tags", () => {
    expect(
      htmlToText('Simon (<a href="https://x">User:simon04</a>)\n<b>x</b>'),
    ).toBe("Simon (User:simon04) x");
    expect(htmlToText(undefined)).toBe("");
  });
});
