// Тексти повідомлень. ОДНЕ місце на весь проєкт.
//
// Це найважливіший файл продукту: саме ці повідомлення ми продаємо. Демо
// показує їх на екрані, бекенд шле їх насправді — з одного джерела, щоб клієнт
// ніколи не отримав не те, що бачив у демо.
//
// Кожне повідомлення описане ЧАСТИНАМИ: заголовок, рядки «ключ → значення»,
// підпис. Так його читають з екрана телефона за секунду, а не вчитуються в
// абзац. `body` для бекенда збирається з тих самих частин, тому вигляд і
// надісланий текст розійтись не можуть.

import { shortDate, servicePrice, totalPrice, durationLabel } from "./format.js";
import { prettyPhone } from "./validate.js";

/**
 * @typedef {Object} Booking
 * @property {string} name
 * @property {string} phone    +380XXXXXXXXX
 * @property {{name:string, price?:number|null, from?:boolean}[]} services
 * @property {string} unit     майстер / пост / лікар
 * @property {Date}   date
 * @property {string} time     "14:30"
 * @property {number} minutes скільки триває візит цілком
 * @property {string} [car]    необов'язкове
 * @property {boolean} [remind]
 */

const names = (b) => b.services.map((s) => s.name).join(" + ");
const when = (b) => `${shortDate(b.date)}, ${b.time}`;
const dur = (b) => durationLabel(b.minutes);
const total = (b) => {
  const t = totalPrice(b.services);
  return t.unit ? `${t.value} ₴` : t.value;
};

/** Рядки в текст для бекенда: «Ключ: значення» по одному на рядок. */
const body = (title, rows, note) =>
  [title, ...rows.map(([k, v]) => `${k}: ${v}`), note].filter(Boolean).join("\n");

/** Клієнту, одразу після запису. */
export function clientConfirmationParts(biz, b) {
  return {
    title: "Вас записано",
    rows: [
      ["Послуга", names(b)],
      ["Коли", when(b)],
      ["Адреса", biz.address],
    ],
    // Не «напишіть нам», а «напишіть тут»: у месенджері це один рух пальцем по
    // тому самому повідомленню, і людині не треба шукати, куди писати.
    note: "Плани змінились? Просто напишіть тут — перенесемо або скасуємо.",
  };
}

export function clientConfirmation(biz, b) {
  const p = clientConfirmationParts(biz, b);
  return body(`${biz.name}: ${p.title}`, p.rows, p.note);
}

/** Адміністратору, одразу. Усе, що треба, — без переходів кудись. */
export function adminAlertParts(biz, b) {
  return {
    title: `Новий запис · ${when(b)}`,
    rows: [
      ["Клієнт", `${b.name}, ${prettyPhone(b.phone)}`],
      ["Послуга", `${names(b)} · ${dur(b)}`],
      ["Авто", b.car || "не вказано"],
      [biz.unitTitle ?? "Майстер", b.unit],
      ["Сума", total(b)],
    ],
  };
}

export function adminAlert(biz, b) {
  const p = adminAlertParts(biz, b);
  return body(p.title, p.rows);
}

/** Нагадування клієнту за добу. */
export function clientReminderParts(biz, b) {
  return {
    title: "Нагадування",
    lines: [
      `Завтра о ${b.time} чекаємо вас у ${biz.name}.`,
      `${names(b)} · ${dur(b)}`,
    ],
    note: "Підтвердіть, будь ласка, щоб ми не тримали час даремно.",
    // Дві кнопки замість «відповідайте текстом»: одне торкання, і адміністратор
    // одразу знає, чи звільняти годину.
    buttons: ["Буду", "Перенести"],
  };
}

export function clientReminder(biz, b) {
  const p = clientReminderParts(biz, b);
  return [p.title, ...p.lines, p.note].join("\n");
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

/** Хто з ким листується. Клієнт бачить бота закладу, власник — свій канал. */
function chats(biz) {
  return {
    client: { name: biz.name, sub: "бот · онлайн", tag: "клієнту", avatar: biz.name.slice(0, 1) },
    admin: { name: `${biz.name} · записи`, sub: `канал ${biz.kind ?? "закладу"}`, tag: "адміну", avatar: "С" },
  };
}

/**
 * Усі повідомлення разом — у такому вигляді їх показує демо і шле бекенд.
 * Нагадування людина може вимкнути в останньому кроці; підтвердження їй і
 * сповіщення адміністратору — ні, без них запис просто не працює.
 */
export function buildAll(biz, b, now = new Date()) {
  const c = chats(biz);
  const all = [
    { to: "client", channel: "telegram", when: "одразу", chat: c.client, parts: clientConfirmationParts(biz, b), body: clientConfirmation(biz, b) },
    { to: "admin", channel: "telegram", when: "одразу", chat: c.admin, parts: adminAlertParts(biz, b), body: adminAlert(biz, b) },
  ];
  if (b.remind !== false) {
    all.push({ to: "client", channel: "telegram", when: reminderAt(b.date, 10, now), chat: c.client, parts: clientReminderParts(biz, b), body: clientReminder(biz, b) });
  }
  return all;
}
