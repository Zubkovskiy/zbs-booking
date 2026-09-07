// Тексти повідомлень. ОДНЕ місце на весь проєкт.
//
// Це найважливіший файл продукту: саме ці повідомлення ми продаємо. Демо
// показує їх на екрані, бекенд шле їх насправді — з одного джерела, щоб клієнт
// ніколи не отримав не те, що бачив у демо.
//
// КАНАЛИ РІЗНІ, і це не деталь реалізації (D-026):
//
//   клієнту → SMS        власнику → Telegram
//
// Причина технічна й непереборна: у Telegram не можна написати першим. Поки
// людина сама не відкрила чат із ботом закладу, бот для неї не існує. Клієнт
// закладу цього не зробить — він прийшов записатись, а не знайомитись із
// ботом. Власник же відкриває чат один раз при підключенні, і далі Telegram
// для нього безкоштовний.
//
// Наслідок для текстів: SMS коштує грошей за кожні 70 символів кирилиці.
// Підтвердження на 200 символів — це ТРИ SMS, і при 300 записах на місяць
// вони з'їдають абонплату цілком. Тому кожне повідомлення клієнту мусить
// влазити в ОДНЕ SMS, і за цим стежить тест.
//
// Повний запис лишається на екрані: талон уже показує послугу, майстра,
// адресу й тривалість. SMS нагадує про те, що людина щойно бачила, а не
// переказує його ще раз.

import { shortDate, shortAddress, hourPrep, isSameDay, durationLabel, totalPrice } from "./format.js";
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

/** Кирилиця в SMS — це UCS-2: 70 символів на одиничне, 67 на частину довгого. */
export const SMS_LIMIT = 70;
export const SMS_PART = 67;

/**
 * Скільки це коштує: довжина в символах і на скільки SMS вона розпадеться.
 * Рахуємо по кодових точках, а не по `.length`: жодна українська літера в
 * сурогатну пару не розкладається, а от емодзі від клієнта — так.
 */
export function smsLength(text) {
  const chars = [...String(text ?? "")].length;
  return { chars, parts: chars <= SMS_LIMIT ? 1 : Math.ceil(chars / SMS_PART) };
}

/**
 * Обрізати до n символів по межі слова. Не «красивіше», а дешевше: обрізок
 * посеред слова читається як збій, а зайва частина SMS коштує як ціла.
 */
function clip(text, n) {
  const chars = [...String(text)];
  if (chars.length <= n) return String(text);
  if (n <= 1) return "…";
  const head = chars.slice(0, n - 1).join("");
  const space = head.lastIndexOf(" ");
  // Слово, довше за половину ліміту, по межі різати нема де — ріжемо всередині.
  const stem = space > n / 2 ? head.slice(0, space) : head;
  return stem.replace(/[\s.,;:·+-]+$/u, "") + "…";
}

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

/**
 * Послуга для SMS: перша з обраних, решта числом. Перелічувати всі — найдорожчий
 * спосіб сказати те, що людина вже бачила на екрані. Мітка «+2» коротка й чесна.
 */
function smsService(b, room) {
  const rest = b.services.length - 1;
  const extra = rest > 0 ? ` +${rest}` : "";
  const first = clip(b.services[0]?.name ?? "", room - [...extra].length);
  return first + extra;
}

/**
 * Одне SMS клієнту одразу: коли, що і куди. Довгі шматки обрізаються, короткі
 * лишаються цілими — але результат не має права вилізти за 70 символів, тому
 * в кінці стоїть останній запобіжник.
 */
/**
 * Назва закладу на початку — ввічливість, а не необхідність: у SMS вона й так
 * стоїть у полі відправника (альфа-ім'я). Тому довга назва, яка не лишає місця
 * навіть на адресу, прибирається — краще втратити підпис, ніж куди їхати.
 */
function stamped(biz, line) {
  const full = `${biz.name}: ${line}`;
  return [...full].length <= SMS_LIMIT ? full : line;
}

export function clientConfirmation(biz, b) {
  const addr = shortAddress(biz.address);
  const tail = `. ${addr}`;
  // Голий кістяк — «коли» і «куди». Він мусить влізти завжди, послуга додається
  // тільки в те місце, що лишилось.
  const head = stamped(biz, `${shortDate(b.date)} ${b.time}${tail}`).slice(0, -tail.length);
  const room = SMS_LIMIT - [...head].length - [...tail].length - 2;   // 2 — це «, »
  // Менше восьми символів на назву — це вже не назва, а огризок. Тоді послугу
  // не пишемо взагалі: коли й куди важливіші, вони й лишаються.
  const svc = room >= 8 ? `, ${smsService(b, room)}` : "";
  // Після трикрапки крапка не потрібна: «діагностика…. Адреса» читається як помилка.
  const sep = (head + svc).endsWith("…") ? " " : ". ";
  return clip(head + svc + sep + addr, SMS_LIMIT);
}

/** Нагадування напередодні. Те саме одне SMS. */
export function clientReminder(biz, b, at) {
  // «Завтра» бреше, якщо нагадування пішло в день візиту (запис на сьогодні —
  // тоді воно йде за годину, див. reminderAt).
  const day = at && isSameDay(at, b.date) ? "сьогодні" : "завтра";
  const line = `${day} ${hourPrep(b.time)} ${b.time} чекаємо вас. ${shortAddress(biz.address)}`;
  return clip(stamped(biz, line), SMS_LIMIT);
}

/**
 * Частини для екрана. У SMS немає ні заголовка, ні аватарки, ні рядків
 * «ключ: значення» — є відправник і рядок тексту. Тому й показуємо саме це.
 *
 * `shown` — той самий текст без назви закладу на початку: у банері сповіщення
 * відправник уже написаний зверху, і повторювати його двічі означає малювати
 * не те, що людина побачить у телефоні.
 */
function smsParts(biz, text) {
  const prefix = `${biz.name}: `;
  return { from: biz.name, text, shown: text.startsWith(prefix) ? text.slice(prefix.length) : text };
}

export function clientConfirmationParts(biz, b) {
  return smsParts(biz, clientConfirmation(biz, b));
}

export function clientReminderParts(biz, b, at) {
  return smsParts(biz, clientReminder(biz, b, at));
}

/**
 * Власнику — в Telegram, і тут економити нема на чому. Усе, що треба, одним
 * екраном: кому дзвонити, що робити, скільки це коштує.
 */
export function adminAlertParts(biz, b) {
  return {
    title: `Новий запис · ${when(b)}`,
    rows: [
      ["Клієнт", b.name],
      // Номер окремим рядком: адміністратор із нього дзвонить, і шукати його
      // всередині рядка з іменем — зайва робота щоразу.
      ["Телефон", prettyPhone(b.phone)],
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

/** Канал власника. У клієнта каналу немає — у нього просто номер телефона. */
function adminChat(biz) {
  return { name: `${biz.name} · записи`, sub: `канал ${biz.kind ?? "закладу"}`, tag: "вам", avatar: "С" };
}

/**
 * Усі повідомлення разом — у такому вигляді їх показує демо і шле бекенд.
 * Нагадування людина може вимкнути в останньому кроці; підтвердження їй і
 * сповіщення власнику — ні, без них запис просто не працює.
 */
export function buildAll(biz, b, now = new Date()) {
  const all = [
    { to: "client", channel: "sms", when: "одразу", parts: clientConfirmationParts(biz, b), body: clientConfirmation(biz, b) },
    { to: "admin", channel: "telegram", when: "одразу", chat: adminChat(biz), parts: adminAlertParts(biz, b), body: adminAlert(biz, b) },
  ];
  if (b.remind !== false) {
    const at = reminderAt(b.date, 10, now);
    all.push({ to: "client", channel: "sms", when: at, parts: clientReminderParts(biz, b, at), body: clientReminder(biz, b, at) });
  }
  return all;
}
