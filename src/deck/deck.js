// Презентація: два перемикачі й більше нічого.
//
// Сторінка навмисно майже статична. Усе, що вона робить, — тримає тему й
// формат в атрибутах кореня та пам'ятає вибір між відкриттями. Ані анімацій,
// ані фетчів: це те, що власник відкриває з листа й гортає великим пальцем.

import { startTheme, startLayout, flipTheme, flipLayout, themeLabel, layoutLabel } from "../core/theme.js";

const KEY_THEME = "zbs-deck-theme";
const KEY_LAYOUT = "zbs-deck-layout";

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

  // Презентація за задумом світла: її показують удень, часто з чужого
  // телефона. Системну темну поважаємо лише як запасний варіант у startTheme.
  let theme = startTheme(recall(KEY_THEME), media.matches, "light");
  let layout = startLayout(recall(KEY_LAYOUT), doc.defaultView.innerWidth);

  const bTheme = doc.getElementById("t-theme");
  const bLayout = doc.getElementById("t-layout");

  function paint() {
    root.dataset.theme = theme;
    root.dataset.layout = layout;
    bTheme.textContent = themeLabel(theme);
    bLayout.textContent = layoutLabel(layout);
  }

  bTheme.onclick = () => { theme = flipTheme(theme); remember(KEY_THEME, theme); paint(); };
  bLayout.onclick = () => { layout = flipLayout(layout); remember(KEY_LAYOUT, layout); paint(); };

  paint();
}
