// Тема і формат: чиста логіка перемикачів, без DOM.
//
// Правило, заради якого це окремий файл: **підпис кнопки показує НАСТУПНИЙ
// стан, а не поточний.** Кнопка «Темна тема» вмикає темну; кнопка «Світла
// тема» вмикає світлу. Інакше людина читає її як індикатор і тисне навпаки.

export const THEMES = ["light", "dark"];
export const LAYOUTS = ["phone", "desk"];

/** Ширина, з якої артборд презентації показується у форматі ПК. */
export const DESK_FROM = 1180;

const okTheme = (v) => THEMES.includes(v);
const okLayout = (v) => LAYOUTS.includes(v);

/**
 * З чого починаємо. Збережений вибір людини сильніший за все; його немає —
 * беремо системну настройку, а якщо сторінка має власну думку (презентація
 * світла за задумом), її передають третім аргументом.
 */
export function startTheme(stored, systemDark, fallback) {
  if (okTheme(stored)) return stored;
  if (okTheme(fallback)) return fallback;
  return systemDark ? "dark" : "light";
}

/** Формат: збережений вибір, інакше за шириною вікна. */
export function startLayout(stored, width) {
  return okLayout(stored) ? stored : autoLayout(width);
}

/** Широкий екран — артборд 1280×720, решта — 480×900. */
export function autoLayout(width) {
  return width >= DESK_FROM ? "desk" : "phone";
}

export function flipTheme(theme) {
  return theme === "dark" ? "light" : "dark";
}

export function flipLayout(layout) {
  return layout === "desk" ? "phone" : "desk";
}

/** Що напише кнопка, коли зараз стоїть `theme`. */
export function themeLabel(theme) {
  return flipTheme(theme) === "dark" ? "Темна тема" : "Світла тема";
}

export function layoutLabel(layout) {
  return flipLayout(layout) === "desk" ? "Формат ПК" : "Формат телефона";
}
