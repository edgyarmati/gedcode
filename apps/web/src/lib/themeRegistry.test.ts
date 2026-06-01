import { describe, expect, it } from "vitest";

import {
  getDesktopTheme,
  getThemeScheme,
  isTheme,
  migrateLegacyTheme,
  resolveConcreteTheme,
  THEME_OPTIONS,
} from "./themeRegistry";

describe("themeRegistry", () => {
  it("exposes the expected selectable themes", () => {
    expect(THEME_OPTIONS.map((option) => option.value)).toEqual([
      "system",
      "light",
      "dark",
      "gruvbox-light",
      "gruvbox-dark",
      "midnight",
      "dracula",
    ]);
  });

  it("migrates legacy light and dark to explicit Gruvbox themes", () => {
    expect(migrateLegacyTheme("light")).toBe("gruvbox-light");
    expect(migrateLegacyTheme("dark")).toBe("gruvbox-dark");
    expect(migrateLegacyTheme("system")).toBe("system");
    expect(migrateLegacyTheme("midnight")).toBeNull();
  });

  it("resolves system to concrete clean light and dark palettes", () => {
    expect(resolveConcreteTheme("system", false)).toBe("light");
    expect(resolveConcreteTheme("system", true)).toBe("dark");
    expect(resolveConcreteTheme("dracula", false)).toBe("dracula");
  });

  it("maps concrete themes to schemes and desktop-safe values", () => {
    expect(getThemeScheme("gruvbox-light")).toBe("light");
    expect(getThemeScheme("midnight")).toBe("dark");
    expect(getDesktopTheme("system", "dark")).toBe("system");
    expect(getDesktopTheme("dracula", "dracula")).toBe("dark");
  });

  it("validates all new theme ids", () => {
    expect(isTheme("dracula")).toBe(true);
    expect(isTheme("midnight")).toBe(true);
    expect(isTheme("solarized")).toBe(false);
  });
});
