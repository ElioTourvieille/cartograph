export const THEME_KEY = "theme";
export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

// Runs before first paint (inlined in <head>) so a forced theme never flashes
// the system one. "system" leaves data-theme off and CSS follows the OS.
export const themeInitScript = `try{var t=localStorage.getItem("${THEME_KEY}");if(t==="light"||t==="dark")document.documentElement.dataset.theme=t}catch(e){}`;
