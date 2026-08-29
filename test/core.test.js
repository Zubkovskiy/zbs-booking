import { test } from "node:test";
import assert from "node:assert/strict";

import { dayKey, hashPercent, buildSlots, countFree, nextDays, bestDayIndex, monthGrid, monthIndex } from "../src/core/schedule.js";
import { plural, shortDate, dayLabel, relDayLabel, relLongDayLabel, longDate, monthTitle, freeLabel, freeDaysLabel, busyReason } from "../src/core/format.js";
import { normalizePhone, prettyPhone, normalizeName } from "../src/core/validate.js";
import { clientConfirmation, adminAlert, reminderAt, buildAll } from "../src/core/messages.js";
import { stepStates, activeStep, STEP_HINT } from "../src/core/guide.js";

const HOURS = { from: 9, to: 12, stepMin: 60 };
const BIZ = { name: "Мега-Сервіс", address: "вул. Москаленка, 20" };
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
  service: "Комп'ютерна діагностика",
  unit: "Пост 1 · Андрій",
  date: new Date(2026, 7, 31),
  time: "11:00",
};

test("підтвердження клієнту містить усе, що йому треба", () => {
  const t = clientConfirmation(BIZ, BOOKING);
  for (const part of ["Мега-Сервіс", "Комп'ютерна діагностика", "31 сер", "11:00", "вул. Москаленка, 20"]) {
    assert.ok(t.includes(part), `бракує: ${part}`);
  }
});

test("адміністратор бачить телефон у читабельному вигляді", () => {
  const t = adminAlert(BIZ, BOOKING);
  assert.ok(t.includes("+380 67 111 22 33"));
  assert.ok(t.includes("Богдан"));
});

test("нагадування ставиться за добу на 10:00", () => {
  const at = reminderAt(BOOKING.date);
  assert.equal(at.getDate(), 30);
  assert.equal(at.getHours(), 10);
});

test("buildAll дає рівно три повідомлення в правильному порядку", () => {
  const all = buildAll(BIZ, BOOKING);
  assert.equal(all.length, 3);
  assert.deepEqual(all.map((m) => m.to), ["client", "admin", "client"]);
  assert.equal(all[0].when, "одразу");
  assert.equal(all[1].when, "одразу");
  assert.ok(all[2].when instanceof Date, "нагадування має конкретний час");
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
  const all = buildAll(BIZ, BOOKING);

  assert.equal(
    all[0].body,
    [
      "Мега-Сервіс",
      "Вас записано: Комп'ютерна діагностика",
      "31 сер, 11:00",
      "вул. Москаленка, 20",
      "Щоб скасувати або перенести — просто відповідайте на це повідомлення.",
    ].join("\n"),
  );

  assert.equal(
    all[1].body,
    ["Новий запис", "Богдан · +380 67 111 22 33", "Комп'ютерна діагностика", "31 сер, 11:00 · Пост 1 · Андрій"].join("\n"),
  );

  assert.equal(
    all[2].body,
    [
      "Нагадуємо: завтра о 11:00 чекаємо вас у Мега-Сервіс.",
      "вул. Москаленка, 20",
      "Щось змінилось? Відповідайте на це повідомлення.",
    ].join("\n"),
  );
});

test("у кожного повідомлення є частини, з яких демо малює бабл", () => {
  for (const m of buildAll(BIZ, BOOKING)) {
    assert.ok(m.parts.who, "має бути підпис, кому це йде");
    assert.ok(m.parts.sender, "має бути відправник");
    assert.equal(m.parts.avatar.length, 1, "аватар — одна літера");
    assert.ok(m.parts.title.length > 3);
    assert.ok(Array.isArray(m.parts.lines) && m.parts.lines.length > 0);
    // Усе, що показує бабл, має бути і в тексті, який реально надсилається.
    assert.ok(m.body.includes(m.parts.title));
    for (const line of m.parts.lines) assert.ok(m.body.includes(line), `рядок загубився: ${line}`);
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
