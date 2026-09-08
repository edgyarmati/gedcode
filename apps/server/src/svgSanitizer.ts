import createDOMPurify, { type Config, type WindowLike } from "dompurify";
import { JSDOM } from "jsdom";

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

const window = new JSDOM("", { contentType: "text/html" }).window;
const purifier = createDOMPurify(window as unknown as WindowLike);
const RESOURCE_REFERENCE_ATTRIBUTES = new Set(["href", "src", "xlink:href"]);
const CSS_URL_REFERENCE = /url\(\s*(["']?)(.*?)\1\s*\)/giu;

function containsExternalCssUrl(value: string): boolean {
  for (const match of value.matchAll(CSS_URL_REFERENCE)) {
    if (!(match[2] ?? "").trim().startsWith("#")) {
      return true;
    }
  }
  return false;
}

purifier.addHook("uponSanitizeAttribute", (_node, event) => {
  const value = event.attrValue.trim();
  if (
    (RESOURCE_REFERENCE_ATTRIBUTES.has(event.attrName.toLowerCase()) &&
      value.length > 0 &&
      !value.startsWith("#")) ||
    containsExternalCssUrl(value)
  ) {
    event.keepAttr = false;
  }
});

const SVG_SANITIZER_CONFIG = {
  USE_PROFILES: { svg: true },
  NAMESPACE: SVG_NAMESPACE,
  FORBID_TAGS: [
    "foreignObject",
    "iframe",
    "object",
    "embed",
    "script",
    "style",
    "animate",
    "animateMotion",
    "animateTransform",
    "set",
  ],
  FORBID_ATTR: ["style"],
  ALLOW_ARIA_ATTR: true,
  ALLOW_DATA_ATTR: false,
  KEEP_CONTENT: false,
} as const satisfies Config;

export function sanitizeSvgMarkup(markup: string): string {
  const parsed = new window.DOMParser().parseFromString(markup, "image/svg+xml");
  const root = parsed.documentElement;
  if (
    root.localName !== "svg" ||
    root.namespaceURI !== SVG_NAMESPACE ||
    parsed.querySelector("parsererror") !== null
  ) {
    return "";
  }

  const sanitized = purifier.sanitize(markup, SVG_SANITIZER_CONFIG).trim();
  return sanitized.startsWith("<svg") ? sanitized : "";
}
