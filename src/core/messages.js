// Тексти повідомлень. ОДНЕ місце на весь проєкт.
//
// Це найважливіший файл продукту: саме ці три повідомлення ми продаємо.
// Демо показує їх на екрані, бекенд шле їх насправді — з одного джерела,
// щоб клієнт ніколи не отримав не те, що бачив у демо.

import { shortDate } from "./format.js";
import { prettyPhone } from "./validate.js";

/**
 * @typedef {Object} Booking
 * @property {string} name
 * @property {string} phone   +380XXXXXXXXX
 * @property {string} service
 * @property {string} unit    майстер / пост / лікар
 * @property {Date}   date
 * @property {string} time    "14:30"
 */

/** Клієнту, одразу після запису. */
export function clientConfirmation(biz, b) {
  return [
    biz.name,
    `Вас записано: ${b.service}`,
    `${shortDate(b.date)}, ${b.time}`,
    biz.address,
    "Щоб скасувати або перенести — просто відповідайте на це повідомлення.",
  ].join("\n");
}

/** Адміністратору, одразу. Усе, що треба, — без переходів кудись. */
export function adminAlert(biz, b) {
  return [
    "Новий запис",
    `${b.name} · ${prettyPhone(b.phone)}`,
    b.service,
    `${shortDate(b.date)}, ${b.time} · ${b.unit}`,
  ].join("\n");
}

/** Нагадування клієнту за добу. */
export function clientReminder(biz, b) {
  return [
    `Нагадуємо: завтра о ${b.time} чекаємо вас у ${biz.name}.`,
    biz.address,
    "Щось змінилось? Відповідайте на це повідомлення.",
  ].join("\n");
}

/** Коли надсилати нагадування: за добу, о 10:00. */
export function reminderAt(date, hour = 10) {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  d.setHours(hour, 0, 0, 0);
  return d;
}

/** Усі три разом — у такому вигляді їх показує демо і шле бекенд. */
export function buildAll(biz, b) {
  return [
    { to: "client", channel: "telegram", when: "одразу", body: clientConfirmation(biz, b) },
    { to: "admin", channel: "telegram", when: "одразу", body: adminAlert(biz, b) },
    { to: "client", channel: "telegram", when: reminderAt(b.date), body: clientReminder(biz, b) },
  ];
}
