import { test } from "node:test";
import assert from "node:assert/strict";

import { dayKey, hashPercent, buildSlots, countFree, nextDays, bestDayIndex, monthGrid, monthIndex, groupByPartOfDay, slotStarts, countStarts, visitMinutes, slotsNeeded, ticketCode } from "../src/core/schedule.js";
import { plural, shortDate, dayLabel, relDayLabel, relLongDayLabel, longDate, dayWithWeekday, durationLabel, splitPrice, monthTitle, freeLabel, freeDaysLabel, busyReason, shortAddress, hourPrep } from "../src/core/format.js";
import { icsEvent, mapsLink } from "../src/core/calendar.js";
import { normalizePhone, prettyPhone, normalizeName, localPhone } from "../src/core/validate.js";
import { clientConfirmation, clientReminder, adminAlert, reminderAt, buildAll, smsLength } from "../src/core/messages.js";
import { stepStates, activeStep, openStep, STEP_HINT } from "../src/core/guide.js";
import { stepScrollTop, scrollDuration, easeInOut } from "../src/core/scroll.js";

const HOURS = { from: 9, to: 12, stepMin: 60 };
const BIZ = {
  name: "Мега-Сервіс", kind: "СТО", address: "вул. Москаленка, 20",
  unitTitle: "Майстер", hours: { from: 9, to: 18, stepMin: 60 },
};
const never = () => false;
const always = () => true;

/* ── дати ───────────────────────────────────────────────────────────── */

test("dayKey бере локальну дату, а не UTC", () => {
  // 23:30 за Києвом — в UTC це вже інша доба. Ключ має лишитись місцевим.
  const d = new Date(2026, 7, 29, 23, 30);
  assert.equal(dayKey(d), "2026-08-29");
});

test("nextDays повертає рівно потрібну кількість днів підряд", () => {
  const days = nextDays(new Date(2026, 7, 30), 3);
  assert.equal(days.length, 3);
  assert.deepEqual(days.map((d) => d.getDate()), [30, 31, 1]);
  assert.equal(days[2].getMonth(), 8, "має перескочити на вересень");
});

/* ── зайнятість ─────────────────────────────────────────────────────── */

test("hashPercent детермінований і в межах 0..99", () => {
  assert.equal(hashPercent("2026-08-29|0|3"), hashPercent("2026-08-29|0|3"));
  assert.notEqual(hashPercent("a"), hashPercent("b"));
  for (const s of ["", "x", "довгий рядок з кирилицею"]) {
    const v = hashPercent(s);
    assert.ok(v >= 0 && v < 100, `${s} → ${v}`);
  }
});

/* ── слоти ──────────────────────────────────────────────────────────── */

test("buildSlots будує сітку за кроком", () => {
  const slots = buildSlots(new Date(2026, 7, 30), HOURS, never, new Date(2026, 7, 29));
  assert.deepEqual(slots.map((s) => s.time), ["09:00", "10:00", "11:00"]);
  assert.equal(countFree(slots), 3);
});

test("крок 30 хвилин", () => {
  const slots = buildSlots(new Date(2026, 7, 30), { from: 9, to: 10, stepMin: 30 }, never, new Date(2026, 7, 29));
  assert.deepEqual(slots.map((s) => s.time), ["09:00", "09:30"]);
});

test("минулий час на сьогодні закритий, і з запасом leadMin", () => {
  const day = new Date(2026, 7, 30);
  const now = new Date(2026, 7, 30, 9, 30);
  const slots = buildSlots(day, HOURS, never, now, 60); // запас година → 10:00 теж закрито
  assert.deepEqual(slots.map((s) => [s.time, s.free]), [
    ["09:00", false],
    ["10:00", false],
    ["11:00", true],
  ]);
  assert.equal(slots[0].why, "past");
});

test("на майбутній день нічого не ріжеться часом", () => {
  const slots = buildSlots(new Date(2026, 7, 31), HOURS, never, new Date(2026, 7, 30, 23, 0));
  assert.equal(countFree(slots), 3);
});

test("зайняте позначається як taken, а не past", () => {
  const slots = buildSlots(new Date(2026, 7, 31), HOURS, always, new Date(2026, 7, 30));
  assert.equal(countFree(slots), 0);
  assert.ok(slots.every((s) => s.why === "taken"));
});

test("нульовий крок — це помилка, а не нескінченний цикл", () => {
  assert.throws(() => buildSlots(new Date(), { from: 9, to: 10, stepMin: 0 }, never));
});

test("bestDayIndex обирає перший день, де є з чого обрати", () => {
  assert.equal(bestDayIndex([0, 1, 5, 2]), 2, "перевага дню з ≥3 вільними");
  assert.equal(bestDayIndex([0, 1, 2]), 1, "інакше перший непорожній");
  assert.equal(bestDayIndex([0, 0, 0]), 0, "усе зайнято — лишаємось на першому");
});

/* ── мова ───────────────────────────────────────────────────────────── */

test("українська множина", () => {
  const f = (n) => `${n} ${plural(n, "вільне", "вільні", "вільних")}`;
  assert.equal(f(1), "1 вільне");
  assert.equal(f(2), "2 вільні");
  assert.equal(f(4), "4 вільні");
  assert.equal(f(5), "5 вільних");
  assert.equal(f(11), "11 вільних", "11 — виняток");
  assert.equal(f(12), "12 вільних");
  assert.equal(f(21), "21 вільне");
  assert.equal(f(22), "22 вільні");
  assert.equal(f(25), "25 вільних");
  assert.equal(f(0), "0 вільних");
});

test("shortDate і dayLabel", () => {
  assert.equal(shortDate(new Date(2026, 7, 29)), "29 сер");
  const now = new Date(2026, 7, 29);
  assert.equal(dayLabel(new Date(2026, 7, 29), now), "сьогодні");
  assert.equal(dayLabel(new Date(2026, 7, 30), now), "завтра");
  assert.equal(dayLabel(new Date(2026, 7, 31), now), "Пн");
});

/* ── телефон ────────────────────────────────────────────────────────── */

test("телефон приймається в будь-якому вигляді", () => {
  for (const raw of [
    "0671112233",
    "067 111 22 33",
    "+38 (067) 111-22-33",
    "380671112233",
    "80671112233",
    "671112233",
  ]) {
    const r = normalizePhone(raw);
    assert.equal(r.ok, true, `${raw} має прийматись`);
    assert.equal(r.value, "+380671112233", raw);
  }
});

test("порожній і зіпсований телефон дають зрозумілу помилку", () => {
  for (const raw of ["", "   ", "12345", "абв"]) {
    const r = normalizePhone(raw);
    assert.equal(r.ok, false, raw);
    assert.ok(r.error.length > 5, "помилка має пояснювати, що робити");
  }
});

test("prettyPhone показує номер по-людськи", () => {
  assert.equal(prettyPhone("+380671112233"), "+380 67 111 22 33");
});

test("ім'я: обрізаємо пробіли, не пускаємо порожнє", () => {
  assert.deepEqual(normalizeName("  Богдан   Зубков "), { ok: true, value: "Богдан Зубков" });
  assert.equal(normalizeName("Б").ok, false);
  assert.equal(normalizeName("").ok, false);
});

/* ── повідомлення ───────────────────────────────────────────────────── */

const BOOKING = {
  name: "Богдан",
  phone: "+380671112233",
  services: [{ name: "Комп'ютерна діагностика", price: 600 }],
  unit: "Андрій Бондар",
  date: new Date(2026, 7, 31),
  time: "11:00",
  minutes: 60,
};

/* Клієнту йде SMS, і кожен зайвий символ — це гроші. Межа не рекомендація:
   71 символ кирилиці коштує рівно вдвічі більше за 70. */

test("smsLength рахує символи й частини, а не байти", () => {
  assert.deepEqual(smsLength("а".repeat(70)), { chars: 70, parts: 1 });
  assert.deepEqual(smsLength("а".repeat(71)), { chars: 71, parts: 2 });
  assert.deepEqual(smsLength("а".repeat(134)), { chars: 134, parts: 2 });
  assert.deepEqual(smsLength("а".repeat(135)), { chars: 135, parts: 3 });
  assert.equal(smsLength("").chars, 0);
});

test("підтвердження клієнту влазить в ОДНЕ SMS і містить головне", () => {
  const t = clientConfirmation(BIZ, BOOKING);
  assert.equal(smsLength(t).parts, 1, `${smsLength(t).chars} символів: ${t}`);
  for (const part of ["Мега-Сервіс", "31 сер", "11:00", "Москаленка 20"]) {
    assert.ok(t.includes(part), `бракує: ${part}`);
  }
});

test("нагадування теж одне SMS, і воно не переказує запис заново", () => {
  const t = clientReminder(BIZ, BOOKING);
  assert.equal(smsLength(t).parts, 1, `${smsLength(t).chars} символів: ${t}`);
  assert.ok(t.includes("завтра"));
  assert.ok(t.includes("11:00"));
  // «Об» перед голосною: одинадцята — єдина година, що її потребує.
  assert.ok(t.includes("об 11:00"), t);
  assert.ok(!t.includes("Послуга"), "перелік послуг у нагадуванні зайвий");
});

test("довга назва послуги скорочує SMS, а не роздуває його", () => {
  const long = { ...BOOKING, services: [{ name: "Комп'ютерна діагностика блоків керування", price: 1000 }] };
  const t = clientConfirmation(BIZ, long);
  assert.equal(smsLength(t).parts, 1, `${smsLength(t).chars} символів: ${t}`);
  assert.ok(t.includes("…"), "обрізане має бути видно");
  // Обрізаємо саме назву послуги — коли й куди лишаються цілими.
  assert.ok(t.includes("31 сер 11:00") && t.includes("Москаленка 20"), t);
});

test("кілька послуг: перша й лічильник решти, і все одно одне SMS", () => {
  const many = {
    ...BOOKING,
    services: [
      { name: "Комп'ютерна діагностика блоків керування", price: 1000 },
      { name: "Шиномонтаж, R16", price: 120 },
      { name: "Озонування салону", price: 400 },
    ],
    minutes: 180,
  };
  const t = clientConfirmation(BIZ, many);
  assert.equal(smsLength(t).parts, 1, `${smsLength(t).chars} символів: ${t}`);
  assert.ok(t.includes("+2"), `решта має бути порахована: ${t}`);
});

test("назва закладу поступається адресі, коли місця не вистачає обом", () => {
  const big = { name: "Стоматологічна клініка «Білий Ведмідь» на Оболоні", address: "Київ, просп. Володимира Івасюка, 122-Б" };
  const t = clientConfirmation(big, { ...BOOKING, services: [{ name: "Професійна гігієна порожнини рота" }] });
  assert.equal(smsLength(t).parts, 1, `${smsLength(t).chars} символів: ${t}`);
  assert.ok(t.includes("Івасюка 122-Б"), `куди їхати важливіше за підпис: ${t}`);
});

test("місяць і час у SMS — рівно ті самі, що на екрані", () => {
  const t = clientConfirmation(BIZ, BOOKING);
  assert.ok(t.includes(shortDate(BOOKING.date)), "місяць скорочуємо одним способом на весь проєкт");
  assert.ok(t.includes(BOOKING.time), "час не переформатовуємо");
});

test("адреса для SMS втрачає місто й тип вулиці, але не будинок", () => {
  assert.equal(shortAddress("Бровари, вул. Сергія Москаленка, 20"), "Москаленка 20");
  assert.equal(shortAddress("вул. Москаленка, 20"), "Москаленка 20");
  assert.equal(shortAddress("Київ, Хрещатик 1"), "Хрещатик 1");
  assert.equal(shortAddress("Бровари, ТЦ Аврора"), "ТЦ Аврора");
  assert.equal(shortAddress(""), "");
});

test("«об» ставиться тільки перед одинадцятою", () => {
  assert.equal(hourPrep("11:00"), "об");
  for (const t of ["09:00", "10:30", "12:00", "18:00"]) assert.equal(hourPrep(t), "о", t);
});

test("адміністратор бачить телефон, авто і суму", () => {
  const t = adminAlert(BIZ, BOOKING);
  assert.ok(t.includes("+380 67 111 22 33"));
  assert.ok(t.includes("Богдан"));
  assert.ok(t.includes("Авто: не вказано"), "порожнє авто має бути названо явно");
  assert.ok(t.includes("600 ₴"), "сума йде адміністратору");
  assert.ok(adminAlert(BIZ, { ...BOOKING, car: "Skoda Octavia" }).includes("Авто: Skoda Octavia"));
});

test("кілька послуг ідуть одним записом і однією сумою", () => {
  const two = {
    ...BOOKING,
    services: [{ name: "Діагностика", price: 600 }, { name: "Шиномонтаж", price: 120, from: true }],
    minutes: 120,
  };
  assert.ok(adminAlert(BIZ, two).includes("Діагностика + Шиномонтаж"), "власник бачить усі послуги");
  // Одна складова приблизна — уся сума приблизна, інакше вона бреше точністю.
  assert.ok(adminAlert(BIZ, two).includes("від 720 ₴"));
});

test("нагадування ставиться за добу на 10:00", () => {
  const at = reminderAt(BOOKING.date, 10, new Date(2026, 7, 20, 12, 0));
  assert.equal(at.getDate(), 30);
  assert.equal(at.getHours(), 10);
});

test("на завтра нагадування не може прийти раніше за сам запис", () => {
  // Записались сьогодні о 16:00 на завтра. «За добу о 10:00» — це вже минуло,
  // і в переписці таке нагадування стало б ПЕРЕД записом.
  const now = new Date(2026, 7, 30, 16, 0);
  const at = reminderAt(new Date(2026, 7, 31), 10, now);
  assert.ok(at > now, "нагадування завжди попереду");
  assert.equal(at.getHours(), 17, "за годину після запису");
});

test("buildAll дає рівно три повідомлення в правильному порядку", () => {
  const all = buildAll(BIZ, BOOKING);
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((m) => m.to), ["client", "admin", "client"]);
  assert.equal(all[0].when, "одразу");
  assert.equal(all[1].when, "одразу");
  assert.ok(all[2].when instanceof Date, "нагадування має конкретний час");
});

test("канали розділені: клієнту SMS, власнику Telegram (D-026)", () => {
  const all = buildAll(BIZ, BOOKING);
  assert.deepEqual(all.map((m) => m.channel), ["sms", "telegram", "sms"]);
  // У Telegram не можна написати першим — клієнт цей чат ніколи не відкриє.
  for (const m of all.filter((x) => x.to === "client")) {
    assert.equal(m.channel, "sms");
    assert.equal(m.chat, undefined, "у SMS немає ні аватарки, ні статусу «онлайн»");
    assert.equal(m.parts.from, BIZ.name, "натомість є відправник");
    assert.equal(smsLength(m.body).parts, 1, m.body);
  }
});

test("нагадування в день візиту не каже «завтра»", () => {
  // Записались сьогодні на сьогодні: нагадування йде за годину, і «завтра» в
  // ньому було б прямою брехнею.
  const now = new Date(2026, 7, 31, 9, 0);
  const [, , reminder] = buildAll(BIZ, BOOKING, now);
  assert.ok(reminder.body.includes("сьогодні"), reminder.body);
});

/* ── календар ───────────────────────────────────────────────────────── */

test("monthGrid: тиждень починається з понеділка, спереду рівно стільки порожніх, скільки треба", () => {
  // 1 серпня 2026 — субота, тобто п'ята колонка. Перед нею 5 заповнювачів.
  const cells = monthGrid(2026, 7);
  assert.equal(cells.filter((c) => c.blank).length, 5);
  assert.equal(cells.length, 5 + 31);

  const first = cells[5];
  assert.equal(first.blank, false);
  assert.equal(first.day, 1);
  assert.equal(first.date.getDate(), 1);
  assert.equal(first.date.getMonth(), 7);
});

test("monthGrid позначає вихідні й дає рівно стільки днів, скільки в місяці", () => {
  // лютий 2028 — високосний, 29 днів
  assert.equal(monthGrid(2028, 1).filter((c) => !c.blank).length, 29);

  const cells = monthGrid(2026, 7).filter((c) => !c.blank);
  const weekend = cells.filter((c) => c.weekend).map((c) => c.day);
  assert.ok(weekend.includes(1), "1 серпня — субота");
  assert.ok(weekend.includes(2), "2 серпня — неділя");
  assert.ok(!weekend.includes(3), "3 серпня — понеділок");
});

test("monthIndex дозволяє порівнювати місяці одним числом", () => {
  assert.ok(monthIndex(2026, 11) < monthIndex(2027, 0));
  assert.equal(monthIndex(2027, 0) - monthIndex(2026, 11), 1);
});

/* ── підписи ────────────────────────────────────────────────────────── */

test("relDayLabel: далі за завтра показуємо дату, а не день тижня", () => {
  const now = new Date(2026, 7, 29);
  assert.equal(relDayLabel(new Date(2026, 7, 29), now), "сьогодні");
  assert.equal(relDayLabel(new Date(2026, 7, 30), now), "завтра");
  assert.equal(relDayLabel(new Date(2026, 7, 31), now), "31 сер");
});

test("monthTitle і freeLabel говорять українською", () => {
  assert.equal(monthTitle(2026, 7), "серпень 2026");
  assert.equal(freeLabel(1), "1 вільне місце");
  assert.equal(freeLabel(3), "3 вільні місця");
  assert.equal(freeLabel(5), "5 вільних місць");
  assert.equal(freeLabel(11), "11 вільних місць");
});

test("freeDaysLabel рахує дні, а не місця", () => {
  assert.equal(freeDaysLabel(1), "1 вільний день");
  assert.equal(freeDaysLabel(2), "2 вільні дні");
  assert.equal(freeDaysLabel(26), "26 вільних днів");
});

test("закритий день і забитий день — різні причини, і плутати їх не можна", () => {
  assert.equal(busyReason(true), "не працюємо");
  assert.equal(busyReason(false), "все зайнято");
  assert.notEqual(busyReason(true), busyReason(false));
});

/* ── текст повідомлень не має мовчки поїхати ────────────────────────── */

test("розбивка на частини не змінила жодного символу того, що йде клієнту", () => {
  const all = buildAll(BIZ, BOOKING, new Date(2026, 7, 20, 12, 0));

  assert.equal(all[0].body, "Мега-Сервіс: 31 сер 11:00, Комп'ютерна діагностика. Москаленка 20");
  assert.equal(all[2].body, "Мега-Сервіс: завтра об 11:00 чекаємо вас. Москаленка 20");

  assert.equal(
    all[1].body,
    [
      "Новий запис · 31 сер, 11:00",
      "Клієнт: Богдан",
      "Телефон: +380 67 111 22 33",
      "Послуга: Комп'ютерна діагностика · 1 год",
      "Авто: не вказано",
      "Майстер: Андрій Бондар",
      "Сума: 600 ₴",
    ].join("\n"),
  );

});

test("екран малює рівно те, що надсилається, — у кожному каналі своє", () => {
  for (const m of buildAll(BIZ, BOOKING)) {
    if (m.channel === "sms") {
      // Банер сповіщення: відправник зверху, текст під ним. Заголовка, рядків
      // «ключ: значення» й аватарки в SMS не буває.
      assert.ok(m.parts.from, "має бути відправник");
      assert.equal(m.parts.text, m.body, "показуємо рівно те, що піде");
      assert.ok(m.body.endsWith(m.parts.shown), "у банері назва закладу не дублюється");
      assert.equal(m.parts.rows, undefined);
      continue;
    }
    assert.ok(m.chat.name, "має бути назва переписки");
    assert.ok(m.chat.tag, "має бути позначка, чий це екран");
    assert.equal(m.chat.avatar.length, 1, "аватар — одна літера");
    assert.ok(m.parts.title.length > 3);
    const shown = [...(m.parts.rows ?? []).map(([, v]) => v), ...(m.parts.lines ?? [])];
    assert.ok(shown.length > 0, "бабл не може бути порожнім");
    // Усе, що показує бабл, має бути і в тексті, який реально надсилається.
    assert.ok(m.body.includes(m.parts.title));
    for (const v of shown) assert.ok(m.body.includes(v), `рядок загубився: ${v}`);
  }
});

/* ── помилка має називати справжню причину ──────────────────────────── */

test("десять цифр не з нуля: помилка не бреше, що цифр мало", () => {
  const r = normalizePhone("3333333333");
  assert.equal(r.ok, false);
  assert.ok(!/10 цифр|замало/.test(r.error), `помилка вводить в оману: ${r.error}`);
  assert.ok(r.error.includes("нуля"), "має сказати, що номер починається з нуля");
});

test("кожна довжина номера пояснюється по-своєму", () => {
  assert.ok(normalizePhone("12345").error.includes("замало"));
  assert.ok(normalizePhone("06711122333331").error.includes("забагато"));
  assert.equal(normalizePhone("067 111 22 33").value, "+380671112233");
});

test("ім'я з цифр не приймається", () => {
  for (const raw of ["7787878", "Олег2", "123 456"]) {
    const r = normalizeName(raw);
    assert.equal(r.ok, false, `${raw} має відхилятись`);
    assert.ok(r.error.includes("цифр"), `помилка має пояснити чому: ${r.error}`);
  }
  assert.equal(normalizeName("Олег").ok, true);
  assert.equal(normalizeName("Анна-Марія").ok, true);
});

/* ── дати словами ───────────────────────────────────────────────────── */

test("longDate пише місяць повністю і в родовому відмінку", () => {
  assert.equal(longDate(new Date(2026, 8, 1)), "1 вересня");
  assert.equal(longDate(new Date(2026, 7, 31)), "31 серпня");
});

test("relLongDayLabel лишає «сьогодні» і «завтра», решту пише повністю", () => {
  const now = new Date(2026, 7, 30);
  assert.equal(relLongDayLabel(new Date(2026, 7, 30), now), "сьогодні");
  assert.equal(relLongDayLabel(new Date(2026, 7, 31), now), "завтра");
  assert.equal(relLongDayLabel(new Date(2026, 8, 2), now), "2 вересня");
});

/* ── супровід кроками ───────────────────────────────────────────────── */

test("супровід іде кроками підряд і жодного не перестрибує", () => {
  // Нічого не заповнюється за людину, тому фокус рухається 1 → 2 → 3 → 4 → 5.
  // Саме через підставлені відповіді два кроки колись пролітали повз.
  const filled = { service: false, unit: false, day: false, time: false, contact: false };
  const keys = ["service", "unit", "day", "time", "contact"];

  for (let i = 0; i < keys.length; i++) {
    assert.equal(activeStep(stepStates(filled)), i, `на кроці ${i + 1} має вести саме туди`);
    assert.equal(stepStates(filled)[i], "active");
    filled[keys[i]] = true;
  }

  assert.deepEqual(stepStates(filled), ["done", "done", "done", "done", "done"]);
});

test("коли все заповнено — активного кроку немає, лишається кнопка", () => {
  const all = { service: true, unit: true, day: true, time: true, contact: true };
  const states = stepStates(all);
  assert.deepEqual(states, ["done", "done", "done", "done", "done"]);
  assert.equal(activeStep(states), -1);
});

test("активний крок завжди рівно один", () => {
  for (const service of [true, false]) {
    for (const time of [true, false]) {
      for (const contact of [true, false]) {
        const states = stepStates({ service, unit: true, day: true, time, contact });
        assert.equal(states.length, 5);
        assert.ok(states.filter((s) => s === "active").length <= 1, "двох активних бути не може");
      }
    }
  }
});

test("на кожен крок є своя підказка", () => {
  assert.equal(STEP_HINT.length, 5);
  for (const h of STEP_HINT) assert.ok(h.length > 10, `підказка надто коротка: ${h}`);
});

test("у SMS немає кнопок, і вигадувати їх не можна", () => {
  // Інлайн-клавіатура — річ Telegram. У SMS відповідь це набраний текст, тож
  // обіцяти клієнту кнопку «Буду» означало б малювати те, чого він не побачить.
  for (const m of buildAll(BIZ, BOOKING)) assert.equal(m.parts.buttons, undefined);
});

/* ── прокрутка до кроку ─────────────────────────────────────────────── */

const VIEW = { height: 800, inset: 40, max: 5000 };

test("крок, що влазить, стає по центру вільного місця під шапкою", () => {
  // Вільне місце — 760 px під шапкою. Крок 200 px: зверху й знизу по 280.
  // Це головне, що робить прокрутка: наступний крок сам опиняється під пальцем.
  assert.equal(stepScrollTop({ top: 1000, height: 200 }, VIEW), 1000 - 40 - 280);
});

test("крок, вищий за екран, ведеться заголовком під шапку", () => {
  // Календар вищий за вікно. Ставити його по центру — значить сховати заголовок.
  assert.equal(stepScrollTop({ top: 1000, height: 900 }, VIEW), 1000 - 40 - 14);
});

test("прокрутка не вилазить за межі документа", () => {
  assert.equal(stepScrollTop({ top: 10, height: 100 }, VIEW), 0, "вище початку не буває");
  assert.equal(stepScrollTop({ top: 9000, height: 100 }, VIEW), 5000, "нижче кінця теж");
  assert.equal(stepScrollTop({ top: 300, height: 100 }, { ...VIEW, max: -50 }), 0);
});

test("тривалість подорожі росте з відстанню, але має обидві межі", () => {
  assert.equal(scrollDuration(0), 600, "коротка дорога все одно триває не менше за переходи розкладки");
  assert.ok(scrollDuration(0) >= 500, "інакше прокрутка скінчиться раніше, ніж стане розкладка");
  assert.equal(scrollDuration(-400), scrollDuration(400), "напрямок не важить");
  assert.ok(scrollDuration(400) > scrollDuration(100), "далі — довше");
  assert.equal(scrollDuration(100000), 1100, "довга дорога не стає нескінченною");
});

test("крива розгону починається в нулі, закінчується в одиниці й обрізає вихід за межі", () => {
  assert.equal(easeInOut(0), 0);
  assert.equal(easeInOut(1), 1);
  assert.ok(Math.abs(easeInOut(0.5) - 0.5) < 1e-12, "симетрична посередині");
  assert.equal(easeInOut(-3), 0);
  assert.equal(easeInOut(9), 1);
  let prev = -1;
  for (let i = 0; i <= 20; i++) {
    const v = easeInOut(i / 20);
    assert.ok(v >= prev, "назад крива не йде");
    prev = v;
  }
});

test("пік швидкості на кривій невисокий — саме з нього береться відчуття ривка", () => {
  const step = 1 / 600;
  let peak = 0;
  for (let t = 0; t < 1; t += step) peak = Math.max(peak, (easeInOut(t + step) - easeInOut(t)) / step);
  // Середня швидкість дороги — рівно 1. У кубічної кривої пік удвічі вищий,
  // у цієї має бути близько π/2.
  assert.ok(peak < 1.62, `пік ${peak.toFixed(3)} — крива стала різкішою`);
  assert.ok(peak > 1.2, "а зовсім рівна швидкість читається як механічна");
});

/* ── згорнуті кроки ─────────────────────────────────────────────────── */

test("відкритий крок — той, у якому людина зараз", () => {
  const states = stepStates({ service: true, unit: false, day: false, time: false, contact: false });
  assert.equal(openStep(states), 1, "перший незаповнений");
});

test("людина сама відкрила пройдений крок — відкритим лишається він", () => {
  const states = stepStates({ service: true, unit: true, day: false, time: false, contact: false });
  assert.equal(openStep(states, 0), 0, "натиснула «змінити» на послузі — там і стоїмо");
  assert.equal(openStep(states, null), 2, "відпустила — ведемо далі за порядком");
  assert.equal(openStep(states, 9), 2, "крок поза списком не рахується");
});

test("коли все заповнено, останній крок лишається відкритим", () => {
  const all = stepStates({ service: true, unit: true, day: true, time: true, contact: true });
  assert.equal(activeStep(all), -1);
  // Інакше поля імені й телефона закрились би просто під пальцем — у ту саму
  // мить, коли номер став правильним.
  assert.equal(openStep(all), 4);
});

test("дата з днем тижня читається без календаря поруч", () => {
  const now = new Date(2026, 8, 2);
  assert.equal(dayWithWeekday(new Date(2026, 8, 2), now), "сьогодні, 2 вересня");
  assert.equal(dayWithWeekday(new Date(2026, 8, 3), now), "завтра, 3 вересня");
  assert.equal(dayWithWeekday(new Date(2026, 8, 5), now), "субота, 5 вересня");
  assert.equal(dayWithWeekday(new Date(2026, 8, 7), now), "понеділок, 7 вересня");
});

/* ── години по частинах доби ────────────────────────────────────────── */

const AT = (...times) => times.map((time) => ({ time, free: true }));

test("години розкладаються на ранок, день і вечір", () => {
  const groups = groupByPartOfDay(AT("09:00", "11:30", "12:00", "15:00", "16:00", "19:00"));
  assert.deepEqual(groups.map((g) => g.label), ["Ранок", "День", "Вечір"]);
  assert.deepEqual(groups[0].slots.map((s) => s.time), ["09:00", "11:30"]);
  assert.deepEqual(groups[1].slots.map((s) => s.time), ["12:00", "15:00"]);
  assert.deepEqual(groups[2].slots.map((s) => s.time), ["16:00", "19:00"]);
});

test("порожня частина доби не показується зовсім", () => {
  // Підпис над порожнечею гірший за відсутність підпису.
  const groups = groupByPartOfDay(AT("09:00", "10:00"));
  assert.deepEqual(groups.map((g) => g.label), ["Ранок"]);
  assert.deepEqual(groupByPartOfDay([]), []);
});

test("жодна година не губиться і не подвоюється", () => {
  const all = AT("09:00", "10:00", "11:00", "12:00", "13:00", "14:00", "15:00", "16:00", "17:00");
  const flat = groupByPartOfDay(all).flatMap((g) => g.slots.map((s) => s.time));
  assert.deepEqual(flat, all.map((s) => s.time));
});

test("номер запису той самий для того самого запису і різний для різних", () => {
  const a = ticketCode("2026-09-04|09:00|Шиномонтаж");
  assert.equal(a, ticketCode("2026-09-04|09:00|Шиномонтаж"), "той самий запис — той самий номер");
  assert.notEqual(a, ticketCode("2026-09-04|10:00|Шиномонтаж"));
  for (const seed of ["", "x", "довгий рядок з кирилицею"]) {
    const n = ticketCode(seed);
    assert.ok(n >= 1000 && n <= 9999, `${seed} → ${n}`);
  }
});

test("тривалість візиту пишеться по-людськи", () => {
  assert.equal(durationLabel(60), "1 год");
  assert.equal(durationLabel(45), "45 хв");
  assert.equal(durationLabel(90), "1 год 30 хв");
  assert.equal(durationLabel(120), "2 год");
});

test("вимкнене нагадування прибирає саме його, а не всі повідомлення", () => {
  const off = buildAll(BIZ, { ...BOOKING, remind: false });
  assert.deepEqual(off.map((m) => m.to), ["client", "admin"], "лишаються підтвердження і сповіщення");

  const on = buildAll(BIZ, BOOKING);
  assert.equal(on.length, 3, "без прапорця нагадування є за замовчуванням");
  assert.equal(on[2].channel, "sms");
});

/* ── ціна і подія календаря ─────────────────────────────────────────── */

test("ціна ділиться на число й одиницю, а нечислова лишається як є", () => {
  assert.deepEqual(splitPrice("від 1 000 ₴"), { value: "від 1 000", unit: "грн" });
  assert.deepEqual(splitPrice("800 ₴"), { value: "800", unit: "грн" });
  assert.deepEqual(splitPrice("за оглядом"), { value: "за оглядом", unit: "" });
  assert.deepEqual(splitPrice(undefined), { value: "", unit: "" });
});

test("подія для календаря має початок, кінець і місце", () => {
  const ics = icsEvent({
    title: "Шиномонтаж · Мега-Сервіс",
    at: new Date(2026, 8, 7, 9, 0),
    minutes: 60,
    location: "Бровари, вул. Сергія Москаленка, 20",
    uid: "2026-09-07-09:00@zbs-booking",
  });
  assert.match(ics, /^BEGIN:VCALENDAR/);
  assert.match(ics, /DTSTART:20260907T090000/);
  assert.match(ics, /DTEND:20260907T100000/, "кінець на тривалість пізніше");
  // Кома в адресі має бути екранована, інакше вона ділить поле надвоє.
  const loc = ics.split("\r\n").find((l) => l.startsWith("LOCATION:"));
  assert.equal(loc, "LOCATION:Бровари\\, вул. Сергія Москаленка\\, 20");
  assert.match(ics, /END:VCALENDAR$/);
});

test("маршрут веде на карти з адресою в запиті", () => {
  const link = mapsLink("Бровари, вул. Сергія Москаленка, 20");
  assert.match(link, /^https:\/\/www\.google\.com\/maps/);
  assert.ok(link.includes(encodeURIComponent("Бровари, вул. Сергія Москаленка, 20")));
});

/* ── візит довший за годину ─────────────────────────────────────────── */

const FREE = (...flags) => flags.map((free, i) => ({ time: `${String(9 + i).padStart(2, "0")}:00`, free }));

test("дві послуги можна почати тільки там, де вільні дві години поспіль", () => {
  const day = FREE(true, true, false, true, true, true);
  assert.deepEqual(slotStarts(day, 1).map((s) => s.time), ["09:00", "10:00", "12:00", "13:00", "14:00"]);
  assert.deepEqual(slotStarts(day, 2).map((s) => s.time), ["09:00", "12:00", "13:00"]);
  assert.deepEqual(slotStarts(day, 3).map((s) => s.time), ["12:00"]);
});

test("візит не може вилізти за кінець дня", () => {
  // Остання година вільна, але після неї закладу вже немає.
  const day = FREE(false, false, true);
  assert.deepEqual(slotStarts(day, 1).map((s) => s.time), ["11:00"]);
  assert.deepEqual(slotStarts(day, 2), [], "двом годинам тут нема де поміститись");
  assert.equal(countStarts(day, 2), 0);
});

test("день без жодного початку рахується зайнятим, хоч вільні години в ньому є", () => {
  const day = FREE(true, false, true, false, true);
  assert.equal(countStarts(day, 1), 3);
  assert.equal(countStarts(day, 2), 0, "саме це й ховає день у календарі");
});

test("підставлений браузером номер втрачає код країни, а недодрукований — ні", () => {
  // Під полем уже намальовано «+38», тому код країни у видимій частині зайвий.
  assert.equal(localPhone("+380637781144"), "0637781144");
  assert.equal(localPhone("380637781144"), "0637781144");
  assert.equal(localPhone("+38 063 778 11 44"), "0637781144");
  assert.equal(localPhone("80637781144"), "0637781144");
  // А поки цифр менше — людина ще друкує, і рядок під пальцями не переписуємо.
  assert.equal(localPhone("067 111"), "067 111");
  assert.equal(localPhone("0637781144"), "0637781144");
  assert.equal(localPhone(""), "");
});

test("тривалість візиту — сума послуг, а слотів під неї завжди ціле число", () => {
  assert.equal(visitMinutes([{ dur: 90 }, { dur: 45 }], 60), 135);
  assert.equal(visitMinutes([{ dur: 45 }], 60), 45);
  assert.equal(visitMinutes([{}, {}], 60), 120, "без своєї тривалості — один слот");
  assert.equal(visitMinutes([], 60), 60, "порожній вибір рахуємо як одну годину");

  // Півтори години в годинній сітці займають ДВІ: третину слота не продаси.
  assert.equal(slotsNeeded(90, 60), 2);
  assert.equal(slotsNeeded(45, 60), 1);
  assert.equal(slotsNeeded(135, 60), 3);
  assert.equal(slotsNeeded(120, 60), 2, "рівно дві години — це дві, а не три");
});
