import { test } from "node:test";
import assert from "node:assert/strict";

import { dayKey, hashPercent, buildSlots, countFree, nextDays, bestDayIndex } from "../src/core/schedule.js";
import { plural, shortDate, dayLabel } from "../src/core/format.js";
import { normalizePhone, prettyPhone, normalizeName } from "../src/core/validate.js";
import { clientConfirmation, adminAlert, reminderAt, buildAll } from "../src/core/messages.js";

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
