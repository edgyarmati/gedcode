import { describe, expect, it } from "vitest";

import { sanitizeSvgMarkup } from "./svgSanitizer.ts";

describe("sanitizeSvgMarkup", () => {
  it("removes executable markup while preserving ordinary SVG geometry", () => {
    const sanitized = sanitizeSvgMarkup(`
      <svg xmlns="http://www.w3.org/2000/svg" onload="alert('event')">
        <script>alert("script")</script>
        <rect width="24" height="24" fill="#fff" />
      </svg>
    `);

    expect(sanitized).toContain("<rect");
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("onload");
  });

  it("removes external resource references while preserving local fragment references", () => {
    const sanitized = sanitizeSvgMarkup(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <defs><linearGradient id="gradient"><stop offset="0" /></linearGradient></defs>
        <rect width="24" height="24" fill="url(#gradient)" />
        <image href="https://attacker.example/tracker.png" />
      </svg>
    `);

    expect(sanitized).toContain('fill="url(#gradient)"');
    expect(sanitized).not.toContain("attacker.example");
  });

  it("removes SVG animation elements that can mutate sanitized attributes after parsing", () => {
    const sanitized = sanitizeSvgMarkup(`
      <svg xmlns="http://www.w3.org/2000/svg">
        <a href="#safe">
          <rect width="24" height="24" />
          <set attributeName="href" to="https://attacker.example/redirect" />
          <animate attributeName="href" values="#safe;https://attacker.example/redirect" />
          <animateMotion path="M0,0 L10,10" />
          <animateTransform attributeName="transform" type="rotate" from="0" to="360" />
        </a>
      </svg>
    `);

    expect(sanitized).toContain("<rect");
    expect(sanitized).not.toContain("<set");
    expect(sanitized).not.toContain("<animate");
    expect(sanitized).not.toContain("<animateMotion");
    expect(sanitized).not.toContain("<animateTransform");
    expect(sanitized).not.toContain("attacker.example");
  });

  it("rejects sanitized output that is not a complete SVG document", () => {
    expect(sanitizeSvgMarkup('<rect width="24" height="24" />')).toBe("");
    expect(sanitizeSvgMarkup("<script>alert('only payload')</script>")).toBe("");
  });
});
