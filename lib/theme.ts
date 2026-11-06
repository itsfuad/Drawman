// Theme is a class on <html> (set before paint by the script in app/layout.tsx); all colours follow via CSS variables.
export const THEME_KEY = "drawman:theme";

export function toggleTheme() {
  const dark = document.documentElement.classList.toggle("dark");
  try {
    localStorage.setItem(THEME_KEY, dark ? "dark" : "light");
  } catch {
    // Blocked storage: the switch still applies for this session.
  }
}
