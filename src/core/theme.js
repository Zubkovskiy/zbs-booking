// Тема: чиста логіка перемикача, без DOM.
//
// Правило, заради якого це окремий файл: **підпис кнопки показує НАСТУПНИЙ
// стан, а не поточний.** Кнопка «Темна тема» вмикає темну; кнопка «Світла
// тема» вмикає світлу. Інакше людина читає її як індикатор і тисне навпаки.
//
// Формату (телефон / ПК) тут немає навмисно: його вирішує медіазапит у CSS
// презентації. Логіка, яку ніхто не питає, — це логіка, яку ніхто не
// перевіряє.

export const THEMES = ["light", "dark"];

const okTheme = (v) => THEMES.includes(v);

/**
 * З чого починаємо. Збережений вибір людини сильніший за все; його немає —
 * беремо думку самої сторінки (презентація темна за задумом), а якщо і її
 * немає — системну настройку.
 */
export function startTheme(stored, systemDark, fallback) {
  if (okTheme(stored)) return stored;
  if (okTheme(fallback)) return fallback;
  return systemDark ? "dark" : "light";
}

export function flipTheme(theme) {
  return theme === "dark" ? "light" : "dark";
}

/** Що напише кнопка, коли зараз стоїть `theme`. */
export function themeLabel(theme) {
  return flipTheme(theme) === "dark" ? "Темна тема" : "Світла тема";
}
