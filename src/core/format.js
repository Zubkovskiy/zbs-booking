// Формати й українська мова. Одне місце на весь проєкт.

export const WEEKDAY_SHORT = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
export const MONTH_SHORT = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];

/**
 * Українська множина: 1 вільне, 2 вільні, 5 вільних.
 * @param {number} n
 * @param {string} one  вільне
 * @param {string} few  вільні
 * @param {string} many вільних
 */
export function plural(n, one, few, many) {
  const d = Math.abs(n) % 10;
  const h = Math.abs(n) % 100;
  if (d === 1 && h !== 11) return one;
  if (d >= 2 && d <= 4 && (h < 12 || h > 14)) return few;
  return many;
}

/** "29 сер" */
export function shortDate(date) {
  return `${date.getDate()} ${MONTH_SHORT[date.getMonth()]}`;
}

export function isSameDay(a, b) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Підпис на кнопці дня: сьогодні / завтра / Пн */
export function dayLabel(date, now = new Date()) {
  if (isSameDay(date, now)) return "сьогодні";
  const t = new Date(now);
  t.setDate(now.getDate() + 1);
  if (isSameDay(date, t)) return "завтра";
  return WEEKDAY_SHORT[date.getDay()];
}
