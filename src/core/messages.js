// Тексти повідомлень. ОДНЕ місце на весь проєкт.
//
// Це найважливіший файл продукту: саме ці три повідомлення ми продаємо.
// Демо показує їх на екрані, бекенд шле їх насправді — з одного джерела,
// щоб клієнт ніколи не отримав не те, що бачив у демо.
//
// Кожне повідомлення описане ЧАСТИНАМИ (`*Parts`): заголовок, рядки, підпис.
// Демо малює з них бабл месенджера, а `body` для бекенда збирається з тих
// самих частин. Через це вигляд на екрані й надісланий текст не можуть
// розійтись — міняєш частину, міняється і те, і те.

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

/**
 * @typedef {Object} Parts
 * @property {string} who     кому це йде, підпис над баблом
 * @property {string} sender  ім'я відправника в баблі
 * @property {string} avatar  одна літера на аватар
 * @property {string} title   жирний перший рядок
 * @property {string[]} lines рядки під заголовком
 * @property {string} [foot]  дрібний підпис під рискою
 * @property {string[]} [buttons] кнопки під повідомленням, якими клієнт відповідає боту
 */

const join = (...lines) => lines.filter(Boolean).join("\n");

/** Клієнту, одразу після запису. */
export function clientConfirmationParts(biz, b) {
  return {
    who: "Клієнту в Telegram",
    sender: biz.name,
    avatar: biz.name.slice(0, 1),
    title: `Вас записано: ${b.service}`,
    lines: [`${shortDate(b.date)}, ${b.time}`, biz.address],
    // Не «напишіть нам», а «відповідайте»: у месенджері це один рух пальцем
    // по тому самому повідомленню, і людині не треба шукати, куди писати.
    foot: "Плани змінились? Відповідайте на це повідомлення — перенесемо або скасуємо.",
  };
}

export function clientConfirmation(biz, b) {
  const p = clientConfirmationParts(biz, b);
  return join(biz.name, p.title, ...p.lines, p.foot);
}

/** Адміністратору, одразу. Усе, що треба, — без переходів кудись. */
export function adminAlertParts(biz, b) {
  return {
    who: "Адміністратору",
    sender: "Бот записів",
    avatar: "А",
    title: "Новий запис",
    lines: [`${b.name} · ${prettyPhone(b.phone)}`, b.service, `${shortDate(b.date)}, ${b.time} · ${b.unit}`],
  };
}

export function adminAlert(biz, b) {
  const p = adminAlertParts(biz, b);
  return join(p.title, ...p.lines);
}

/** Нагадування клієнту за добу. */
export function clientReminderParts(biz, b) {
  return {
    who: "Нагадування клієнту",
    sender: biz.name,
    avatar: biz.name.slice(0, 1),
    title: `Нагадуємо: завтра о ${b.time} чекаємо вас у ${biz.name}.`,
    lines: [biz.address],
    foot: "Підтвердіть, будь ласка — щоб ми не тримали час даремно.",
    // Дві кнопки замість «відповідайте текстом»: одне торкання, і адміністратор
    // одразу знає, чи звільняти годину.
    buttons: ["Буду", "Не вийде"],
  };
}

export function clientReminder(biz, b) {
  const p = clientReminderParts(biz, b);
  return join(p.title, ...p.lines, p.foot);
}

/**
 * Коли надсилати нагадування: за добу, о 10:00.
 *
 * Запис на завтра ламає це просте правило: «за добу о 10:00» для нього вже
 * минуло. Тоді нагадування йде за годину після запису — інакше воно або не
 * прийде взагалі, або стане в переписці ПЕРЕД самим записом, датою раніше.
 */
export function reminderAt(date, hour = 10, now = new Date()) {
  const d = new Date(date);
  d.setDate(d.getDate() - 1);
  d.setHours(hour, 0, 0, 0);
  return d <= now ? new Date(now.getTime() + 60 * 60 * 1000) : d;
}

/** Усі три разом — у такому вигляді їх показує демо і шле бекенд. */
export function buildAll(biz, b, now = new Date()) {
  return [
    { to: "client", channel: "telegram", when: "одразу", parts: clientConfirmationParts(biz, b), body: clientConfirmation(biz, b) },
    { to: "admin", channel: "telegram", when: "одразу", parts: adminAlertParts(biz, b), body: adminAlert(biz, b) },
    { to: "client", channel: "telegram", when: reminderAt(b.date, 10, now), parts: clientReminderParts(biz, b), body: clientReminder(biz, b) },
  ];
}
