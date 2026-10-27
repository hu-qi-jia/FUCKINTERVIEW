export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "interview-assistant.theme";

export function readTheme(): ThemeMode {
  const stored = localStorage.getItem(STORAGE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export function saveTheme(mode: ThemeMode) {
  localStorage.setItem(STORAGE_KEY, mode);
}

export function systemPrefersDark(): boolean {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function resolveDark(mode: ThemeMode): boolean {
  return mode === "dark" || (mode === "system" && systemPrefersDark());
}
