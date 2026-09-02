import { test } from "node:test";
import assert from "node:assert/strict";

import { dayKey, hashPercent, buildSlots, countFree, nextDays, bestDayIndex, monthGrid, monthIndex } from "../src/core/schedule.js";
import { plural, shortDate, dayLabel, relDayLabel, relLongDayLabel, longDate, dayWithWeekday, monthTitle, freeLabel, freeDaysLabel, busyReason } from "../src/core/format.js";
import { normalizePhone, prettyPhone, normalizeName } from "../src/core/validate.js";
import { clientConfirmation, adminAlert, reminderAt, buildAll } from "../src/core/messages.js";
import { stepStates, activeStep, openStep, STEP_HINT } from "../src/core/guide.js";
import { stepScrollTop, scrollDuration, easeInOut } from "../src/core/scroll.js";

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
      "Плани змінились? Відповідайте на це повідомлення — перенесемо або скасуємо.",
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
      "Підтвердіть, будь ласка — щоб ми не тримали час даремно.",
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

test("нагадування дає кнопки, якими клієнт відповідає боту", () => {
  const [confirm, admin, reminder] = buildAll(BIZ, BOOKING);
  assert.deepEqual(reminder.parts.buttons, ["Буду", "Не вийде"]);
  // Кнопки доречні тільки там, де від клієнта чекають відповіді.
  assert.equal(confirm.parts.buttons, undefined);
  assert.equal(admin.parts.buttons, undefined);
});

/* ── прокрутка до кроку ─────────────────────────────────────────────── */

const VIEW = { height: 800, inset: 40, max: 5000, now: 0 };

test("крок уже видно — сторінка не рухається взагалі", () => {
  // Найважливіший випадок: рух без потреби читається як «блок росте і вгору,
  // і вниз одночасно», хоч насправді розгортається тільки низ.
  assert.equal(stepScrollTop({ top: 100, height: 200 }, VIEW), 0);
  assert.equal(stepScrollTop({ top: 500, height: 250 }, { ...VIEW, now: 400 }), 400);
});

test("нижній край за екраном — підтягуємо рівно до нього", () => {
  // Крок 900..1100, видно до 786. Бракує 314 px — стільки й проїжджаємо.
  assert.equal(stepScrollTop({ top: 900, height: 200 }, { ...VIEW, inset: 0 }), 314);
});

test("підтягуючи знизу, заголовок ніколи не йде за верх екрана", () => {
  // Поки крок влазить у вільне місце, підтягування до нижнього краю не може
  // виштовхнути його заголовок угору. Перевіряємо на всіх висотах, що влазять.
  const view = { ...VIEW, inset: 0 };
  for (let h = 20; h <= 772; h += 16) {
    for (const top of [200, 700, 1500]) {
      const y = stepScrollTop({ top, height: h }, view);
      assert.ok(top - y >= 14 - 0.001, `висота ${h}, верх ${top}: заголовок виїхав на ${top - y}`);
    }
  }
});

test("крок, вищий за екран, ведеться заголовком під шапку", () => {
  // Календар вищий за вікно. Ставити його по центру — значить сховати заголовок.
  const y = stepScrollTop({ top: 1000, height: 900 }, VIEW);
  assert.equal(y, 1000 - 40 - 14);
});

test("крок виїхав угору — опускаємо сторінку рівно до нього", () => {
  const y = stepScrollTop({ top: 100, height: 200 }, { ...VIEW, inset: 0, now: 300 });
  assert.equal(y, 100 - 14);
});

test("прокрутка не вилазить за межі документа", () => {
  assert.equal(stepScrollTop({ top: 10, height: 100 }, { ...VIEW, now: 500 }), 0, "вище початку не буває");
  assert.equal(stepScrollTop({ top: 9000, height: 100 }, VIEW), 5000, "нижче кінця теж");
  assert.equal(stepScrollTop({ top: 300, height: 100 }, { ...VIEW, max: -50, now: 900 }), 0);
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
