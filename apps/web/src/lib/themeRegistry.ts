export const THEME_STORAGE_KEY = "t3code:theme:v2";
export const LEGACY_THEME_STORAGE_KEY = "t3code:theme";

export type Theme =
  | "system"
  | "light"
  | "dark"
  | "gruvbox-light"
  | "gruvbox-dark"
  | "midnight"
  | "dracula";

export type ConcreteTheme = Exclude<Theme, "system">;
export type ThemeScheme = "light" | "dark";
export type DesktopTheme = "light" | "dark" | "system";

export const THEME_OPTIONS: ReadonlyArray<{ value: Theme; label: string }> = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "gruvbox-light", label: "Gruvbox Light" },
  { value: "gruvbox-dark", label: "Gruvbox Dark" },
  { value: "midnight", label: "Midnight" },
  { value: "dracula", label: "Dracula" },
];

const THEME_VALUES = new Set<Theme>(THEME_OPTIONS.map((option) => option.value));
const LEGACY_THEME_MAP: Record<string, Theme> = {
  light: "gruvbox-light",
  dark: "gruvbox-dark",
  system: "system",
};

export function isTheme(value: string | null | undefined): value is Theme {
  return typeof value === "string" && THEME_VALUES.has(value as Theme);
}

export function migrateLegacyTheme(value: string | null | undefined): Theme | null {
  if (!value) return null;
  return LEGACY_THEME_MAP[value] ?? null;
}

export function getThemeScheme(theme: ConcreteTheme): ThemeScheme {
  return theme === "light" || theme === "gruvbox-light" ? "light" : "dark";
}

export function resolveConcreteTheme(theme: Theme, systemDark: boolean): ConcreteTheme {
  if (theme !== "system") return theme;
  return systemDark ? "dark" : "light";
}

export function getDesktopTheme(theme: Theme, concreteTheme: ConcreteTheme): DesktopTheme {
  if (theme === "system") return "system";
  return getThemeScheme(concreteTheme);
}
