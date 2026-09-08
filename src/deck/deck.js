// Презентація: один перемикач і більше нічого.
//
// Сторінка навмисно майже статична. Усе, що вона робить, — тримає тему в
// атрибуті кореня та пам'ятає вибір між відкриттями. Формат (телефон / ПК)
// вирішує медіазапит у CSS: власник і так читає з телефона, а кнопка, яка
// ламає макет під пальцем, йому не потрібна.

import { startTheme, flipTheme, themeLabel } from "../core/theme.js";

const KEY_THEME = "zbs-deck-theme";

const MOON = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.5 14.6A8.6 8.6 0 0 1 9.4 3.5a8.6 8.6 0 1 0 11.1 11.1Z"/></svg>';
const SUN = '<svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.2M12 19.8V22M4.2 12H2M22 12h-2.2M5.6 5.6 4 4M20 20l-1.6-1.6M18.4 5.6 20 4M4 20l1.6-1.6"/></svg>';

/** Приватне вікно, заборонені куки, file:// — сховище буває недоступним. */
function remember(key, value) {
  try { localStorage.setItem(key, value); } catch { /* нема то й нема */ }
}
function recall(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

export function mountDeck(doc) {
  const root = doc.documentElement;
  const media = doc.defaultView.matchMedia("(prefers-color-scheme: dark)");

  // Темна — стан за замовчуванням. Посилання відкривають увечері, з
  // месенджера; світлий екран у темряві б'є по очах. Системну настройку
  // поважаємо лише як запасний варіант у startTheme.
  let theme = startTheme(recall(KEY_THEME), media.matches, "dark");
  const btn = doc.getElementById("t-theme");

  // Значок і підпис показують НАСТУПНИЙ стан, а не поточний: інакше кнопку
  // читають як індикатор і тиснуть навпаки.
  function paint() {
    root.dataset.theme = theme;
    const next = flipTheme(theme);
    btn.innerHTML = next === "dark" ? MOON : SUN;
    btn.setAttribute("aria-label", themeLabel(theme));
    btn.title = themeLabel(theme);
  }

  btn.onclick = () => { theme = flipTheme(theme); remember(KEY_THEME, theme); paint(); };
  paint();
}
