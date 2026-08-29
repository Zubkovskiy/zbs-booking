// Формати й українська мова. Одне місце на весь проєкт.

export const WEEKDAY_SHORT = ["Нд", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
export const MONTH_SHORT = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
export const MONTH_FULL = [
  "січень", "лютий", "березень", "квітень", "травень", "червень",
  "липень", "серпень", "вересень", "жовтень", "листопад", "грудень",
];
/** Родовий відмінок — для дат: «1 вересня». Називний — для заголовка місяця. */
export const MONTH_GEN = [
  "січня", "лютого", "березня", "квітня", "травня", "червня",
  "липня", "серпня", "вересня", "жовтня", "листопада", "грудня",
];
/** Заголовки колонок календаря. Тиждень починається з понеділка. */
export const WEEKDAY_HEAD = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];

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

/** Те саме, але далі за завтра показуємо дату, а не день тижня: «2 вер». */
export function relDayLabel(date, now = new Date()) {
  const near = dayLabel(date, now);
  return near === "сьогодні" || near === "завтра" ? near : shortDate(date);
}

/** «1 вересня» — дата словами, коли є місце написати повністю. */
export function longDate(date) {
  return `${date.getDate()} ${MONTH_GEN[date.getMonth()]}`;
}

/** Те саме, що relDayLabel, але місяць не скорочуємо: «сьогодні» / «1 вересня». */
export function relLongDayLabel(date, now = new Date()) {
  const near = dayLabel(date, now);
  return near === "сьогодні" || near === "завтра" ? near : longDate(date);
}

/** «серпень 2026» — заголовок місяця в календарі. */
export function monthTitle(year, month) {
  return `${MONTH_FULL[month]} ${year}`;
}

/** «5 вільних місць» — скільки годин ще можна зайняти. */
export function freeLabel(n) {
  return `${n} ${plural(n, "вільне місце", "вільні місця", "вільних місць")}`;
}

/** «26 вільних днів» — скільки днів місяця мають вільний час. */
export function freeDaysLabel(n) {
  return `${n} ${plural(n, "вільний день", "вільні дні", "вільних днів")}`;
}

/**
 * Чому день недоступний. Дві причини, і плутати їх не можна: закритий день —
 * це не те саме, що робочий день, у якому все розібрали.
 */
export function busyReason(closed) {
  return closed ? "не працюємо" : "все зайнято";
}
