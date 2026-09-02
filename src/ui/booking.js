// Складання сторінки. Тут тільки DOM і стан екрана.
// Усе, що можна порахувати без браузера, живе в core/ і покрите тестами.
//
// ЖОДЕН блок не перемальовується без потреби: послуги, пости, ярлики днів,
// сітка календаря і плитки часу будуються один раз, далі лише синхронізуються.
// Перемальовування вбивало кожен перехід (нова кнопка не має чому анімуватись),
// губило фокус із клавіатури і давало ту саму смиканину, від якої все й почалось.

import { nextDays, countFree, bestDayIndex, dayKey, monthGrid, monthIndex, isWorkday } from "../core/schedule.js";
import { shortDate, relDayLabel, monthTitle, freeLabel, freeDaysLabel, busyReason, plural, MONTH_FULL, WEEKDAY_HEAD } from "../core/format.js";
import { normalizeName, normalizePhone, prettyPhone } from "../core/validate.js";
import { stepStates, activeStep, STEP_HINT } from "../core/guide.js";
import { createScroller, glideToStep, morphHeight, calmMotion } from "./motion.js";

/** На скільки днів уперед відкритий запис. Три місяці — щоб при щільному
    записі було куди гортати, а не впертись у край вікна. */
const DAYS_AHEAD = 90;

const TICK = '<svg class="tick-sm" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 8.5l3.5 3.5 7.5-8" stroke="var(--free)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEV = '<svg class="chev" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 6l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
// Контур навмисно зміщений під центр кола: канонічний шлях галочки
// «важчий» унизу зліва і в кружку виглядає зсунутим.
const NUM_TICK = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 8.6l3.4 3.4L13.2 5" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const XL_TICK = '<svg width="58" height="58" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 8.5l3.5 3.5 7.5-8" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const BIG_TICK = '<svg width="22" height="22" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 8.5l3.5 3.5 7.5-8" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

const OPT_MARKUP =
  '<span class="t-txt"><span class="t-name"></span><span class="t-note"></span></span>' +
  `<span class="t-right">${TICK}<span class="price"></span></span>`;

const pad = (n) => String(n).padStart(2, "0");

export function mountBooking(root, business, adapter) {
  const $ = (id) => root.getElementById(id);

  /* ── шапка ───────────────────────────────────────────────────────────── */
  $("b-name").textContent = business.name;
  $("b-tag").textContent = business.tagline;
  $("b-where").textContent = `${business.kind} · ${business.address}`;
  $("b-open").textContent = business.openLine ?? "";
  $("unit-title").textContent = business.unitTitle ?? "Майстер";
  $("sig").textContent = business.signature ?? "";

  const state = {
    svc: null,
    svcOpen: true,   // відкритий, доки нічого не обрано: перший екран одразу показує вибір
    unit: null,
    key: null,
    view: null,      // {y, m} — який місяць показує календар
    time: null,
    sending: false,
  };

  /** Вікно запису: 30 днів із розкладом. Перебудовується при зміні поста. */
  let days = [];
  const byKey = new Map();

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  async function loadDays() {
    days = [];
    byKey.clear();

    for (const [i, date] of nextDays(today, DAYS_AHEAD).entries()) {
      const closed = !isWorkday(date, business.workdays);
      // Поки пост не обрано, показуємо наявність за першим — інакше нема з чого
      // намалювати календар. Щойно пост обрано, все перераховується під нього.
      const slots = closed ? [] : await adapter.slots(date, state.unit ?? 0);
      const day = { i, date, key: dayKey(date), closed, slots, free: countFree(slots) };
      days.push(day);
      byKey.set(day.key, day);
    }

    // Обраний раніше день лишаємо, якщо він і далі вільний. Інакше знімаємо
    // вибір, а не підставляємо інший — це вибір людини, не наш.
    const kept = state.key ? byKey.get(state.key) : null;
    if (!kept || kept.free === 0) {
      state.key = null;
      state.time = null;
    } else if (state.time && !kept.slots.some((sl) => sl.time === state.time && sl.free)) {
      state.time = null;
    }

    const focus = kept ?? days[bestDayIndex(days.map((d) => d.free))];
    state.view = { y: focus.date.getFullYear(), m: focus.date.getMonth() };
  }

  const current = () => (state.key ? byKey.get(state.key) : null);

  function pickDay(day) {
    state.key = day.key;
    state.time = null;
    state.view = { y: day.date.getFullYear(), m: day.date.getMonth() };
    paint();
  }

  /* ── крок 1: послуга ─────────────────────────────────────────────────── */
  // Будується один раз. Список лишається в DOM і коли згорнутий — інакше
  // нема чому анімуватись, а перемальовування вбивало б перехід.
  let trigger, svcWrap;
  let shownSvc = null;      // яку послугу тригер показує зараз
  const svcOpts = [];

  function buildService() {
    const box = $("services");

    trigger = document.createElement("button");
    trigger.type = "button";
    trigger.className = "trigger";
    trigger.setAttribute("aria-controls", "svc-list");
    trigger.innerHTML =
      '<span class="t-txt"><span class="t-name"></span><span class="t-note"></span></span>' +
      `<span class="t-right"><span class="price"></span>${CHEV}</span>`;
    trigger.onclick = () => {
      state.svcOpen = !state.svcOpen;
      syncService();
    };

    svcWrap = document.createElement("div");
    svcWrap.className = "svc-wrap";

    // Окремий шар-обрізач: без нього рамка згорнутого списку лишає 2 px висоти.
    const clip = document.createElement("div");
    clip.className = "svc-clip";

    const list = document.createElement("div");
    list.id = "svc-list";
    list.className = "svc-list";
    list.setAttribute("role", "listbox");

    business.services.forEach((s, i) => {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "svc-opt";
      opt.setAttribute("role", "option");
      opt.innerHTML = OPT_MARKUP;
      opt.querySelector(".t-name").textContent = s.name;
      opt.querySelector(".t-note").textContent = s.note ?? "";
      opt.querySelector(".price").textContent = s.price ?? "";
      opt.onclick = () => {
        state.svc = i;
        state.svcOpen = false;
        paint();
      };
      svcOpts.push(opt);
      list.append(opt);
    });

    clip.append(list);
    svcWrap.append(clip);
    box.append(trigger, svcWrap);
  }

  function syncService() {
    const chosen = state.svc === null ? null : business.services[state.svc];

    trigger.className = `trigger${state.svcOpen ? " open" : ""}${chosen ? " chosen" : ""}`;
    trigger.setAttribute("aria-expanded", String(state.svcOpen));
    trigger.querySelector(".t-name").textContent = chosen ? chosen.name : "Оберіть послугу";
    trigger.querySelector(".t-note").textContent = chosen
      ? (chosen.note ?? "")
      : `${business.services.length} ${plural(business.services.length, "послуга", "послуги", "послуг")}`;
    trigger.querySelector(".price").textContent = chosen ? (chosen.price ?? "") : "";

    // Назва підмінилась — проявляємо її, а не міняємо в одну мить.
    if (state.svc !== shownSvc) {
      shownSvc = state.svc;
      trigger.classList.remove("swap");
      void trigger.offsetWidth;          // перезапуск анімації
      trigger.classList.add("swap");
    }

    svcWrap.classList.toggle("open", state.svcOpen);
    svcOpts.forEach((opt, i) => {
      const sel = state.svc === i;
      opt.classList.toggle("sel", sel);
      opt.setAttribute("aria-selected", String(sel));
    });
  }

  /* ── крок 2: пост ────────────────────────────────────────────────────── */
  const unitCards = [];

  function buildUnits() {
    const box = $("units");

    business.units.forEach((u, i) => {
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card";
      card.innerHTML = OPT_MARKUP;
      card.querySelector(".t-name").textContent = u.name;
      card.querySelector(".t-note").textContent = u.note ?? "";
      card.querySelector(".price").remove();
      card.onclick = async () => {
        const changed = state.unit !== i;
        state.unit = i;
        if (changed) await loadDays();   // у іншого поста свій розклад
        paint();
      };
      unitCards.push(card);
      box.append(card);
    });
  }

  function syncUnits() {
    unitCards.forEach((card, i) => {
      const sel = state.unit === i;
      card.classList.toggle("sel", sel);
      card.setAttribute("aria-pressed", String(sel));
    });
  }

  /* ── крок 3: день ────────────────────────────────────────────────────── */
  // Три ярлики: сьогодні, завтра і стрибок на наступний місяць. Під кожним —
  // скільки там вільного, щоб кнопка казала правду ще до натискання.
  function monthOf(day) {
    return monthIndex(day.date.getFullYear(), day.date.getMonth());
  }

  /** Опис ярликів на цю мить. Підсвітка — окремою функцією, бо вона міняється
      на кожен вибір дня, а самі ярлики — тільки коли міняється пост. */
  function quickChips() {
    const chips = [];

    for (const [i, label] of [[0, "сьогодні"], [1, "завтра"]]) {
      const day = days[i];
      if (!day) continue;
      chips.push({
        label,
        sub: day.free ? freeLabel(day.free) : busyReason(day.closed),
        day,
        on: () => state.key === day.key,
      });
    }

    // Наступний місяць, у якому взагалі є вільний час.
    const thisMonth = monthOf(days[0]);
    const first = days.find((d) => monthOf(d) > thisMonth && d.free > 0);
    if (first) {
      const month = monthOf(first);
      const n = days.filter((d) => monthOf(d) === month && d.free > 0).length;
      chips.push({
        label: MONTH_FULL[first.date.getMonth()],
        sub: freeDaysLabel(n),
        day: first,
        on: () => !!current() && monthOf(current()) === month,
      });
    }

    return chips;
  }

  let quickSig = null;    // які написи вже намальовані
  let quickShown = [];    // [{el, chip}]

  function syncQuick() {
    const box = $("quick");
    const chips = quickChips();
    box.hidden = chips.length === 0;

    const sig = chips.map((c) => `${c.label}|${c.sub}|${c.day.key}`).join("~");
    if (sig !== quickSig) {
      quickSig = sig;
      morphHeight(box, () => {
        box.textContent = "";
        quickShown = chips.map((c) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "chip";
          b.dataset.k = `chip-${c.label}`;
          b.disabled = c.day.free === 0;
          b.innerHTML = '<b class="chip-day"></b><span class="chip-free"></span>';
          b.querySelector(".chip-day").textContent = c.label;
          b.querySelector(".chip-free").textContent = c.sub;
          b.setAttribute("aria-label", `${c.label}, ${shortDate(c.day.date)} — ${c.sub}`);
          if (!b.disabled) b.onclick = () => pickDay(c.day);
          box.append(b);
          return { el: b, chip: c };
        });
      });
    }

    for (const { el, chip } of quickShown) el.classList.toggle("on", chip.on());
  }

  let calMonth = null;   // який місяць зараз у сітці
  let calCells = [];     // [{el, date}] — тільки справжні дні, без порожніх
  let headBuilt = false;

  /** Сітка перебудовується ЛИШЕ при зміні місяця. Вибір дня і зміна поста —
      це оновлення класів на тих самих кнопках, тому підсвітка перетікає
      переходом, а не блимає новою кнопкою. */
  function syncCalendar() {
    const { y, m } = state.view;
    const first = days[0];
    const last = days[days.length - 1];
    const shown = monthIndex(y, m);

    const title = $("month");
    if (title.textContent !== monthTitle(y, m)) {
      title.textContent = monthTitle(y, m);
      title.classList.remove("swap");
      void title.offsetWidth;
      title.classList.add("swap");
    }
    $("prev").disabled = shown <= monthIndex(first.date.getFullYear(), first.date.getMonth());
    $("next").disabled = shown >= monthIndex(last.date.getFullYear(), last.date.getMonth());
    $("prev").onclick = () => shiftMonth(-1);
    $("next").onclick = () => shiftMonth(1);

    if (!headBuilt) {
      headBuilt = true;
      const head = $("wd");
      WEEKDAY_HEAD.forEach((t, i) => {
        const s = document.createElement("span");
        if (i > 4) s.className = "we";
        s.textContent = t;
        head.append(s);
      });
    }

    const grid = $("days");
    if (calMonth !== shown) {
      const dir = calMonth === null ? 0 : Math.sign(shown - calMonth);
      calMonth = shown;
      // Місяці з різною кількістю рядків однаково високими не бувають, тому
      // висоту доводимо переходом — інакше все під календарем підстрибує.
      // Клітинки вдягаємо ТУТ ЖЕ, всередині: висоту міряють одразу після
      // цього, а гола кнопка без класу .cell вдвічі нижча за справжню — сітка
      // поїхала б у неправильний бік і клацнула назад у кінці переходу.
      morphHeight(grid, () => {
        grid.textContent = "";
        calCells = [];
        for (const cell of monthGrid(y, m)) {
          const b = document.createElement("button");
          b.type = "button";
          b.innerHTML = '<span class="n"></span><span class="dot"></span>';
          if (cell.blank) {
            b.className = "cell blank";
            b.disabled = true;
          } else {
            b.querySelector(".n").textContent = String(cell.day);
            calCells.push({ el: b, date: cell.date });
          }
          grid.append(b);
        }
        dressCells();
      });
      if (dir) {
        grid.classList.remove("in-back", "in-fwd");
        void grid.offsetWidth;                    // перезапуск анімації
        grid.classList.add(dir > 0 ? "in-fwd" : "in-back");
      }
    } else {
      dressCells();
    }
  }

  /** Стан клітинок: що вільне, що обране, куди можна тицьнути. Розмір від
      цього не залежить, тому переходи заливки грають на місці. */
  function dressCells() {
    for (const { el, date } of calCells) {
      const day = byKey.get(dayKey(date));
      const kind = !day ? "out" : day.free > 0 ? "free" : "none";
      const sel = !!day && day.key === state.key;

      el.className = `cell ${kind}${sel ? " sel" : ""}`;
      el.disabled = kind !== "free";
      el.setAttribute("aria-pressed", String(sel));
      el.title = !day
        ? `запис відкритий на ${DAYS_AHEAD} ${plural(DAYS_AHEAD, "день", "дні", "днів")} уперед`
        : day.free === 0
          ? busyReason(day.closed)
          : freeLabel(day.free);
      el.setAttribute("aria-label", `${shortDate(date)} — ${el.title}`);
      if (kind === "free") {
        el.dataset.k = `cell-${day.key}`;
        el.onclick = () => pickDay(day);
      } else {
        delete el.dataset.k;
        el.onclick = null;
      }
    }
  }

  function shiftMonth(dir) {
    const d = new Date(state.view.y, state.view.m + dir, 1);
    state.view = { y: d.getFullYear(), m: d.getMonth() };
    paint();
  }

  /* ── крок 4: час ─────────────────────────────────────────────────────── */
  let slotsSig = null;   // чий саме розклад намальовано
  let slotEls = [];      // [{el, time}]

  /** Плитки перебудовуються тільки коли змінився день або пост. Натискання на
      час — це один клас, тож обрана плитка заливається переходом, а сітка під
      пальцем не мигає й не переїжджає. */
  function syncSlots() {
    const day = current();
    const box = $("slots");
    const counter = $("p-time");

    if (!day) {
      counter.className = "count zero";
      counter.textContent = "спершу день";
    } else {
      counter.className = `count${day.free ? "" : " zero"}`;
      counter.textContent = `${day.free ? freeLabel(day.free) : busyReason(day.closed)} · ${relDayLabel(day.date, today)}`;
    }

    const sig = day ? `${state.unit}|${day.key}|${day.slots.map((s) => s.time + (s.free ? "+" : "-")).join(",")}` : "";
    if (sig !== slotsSig) {
      slotsSig = sig;
      // Порожньо → повна сітка годин — це найбільший стрибок висоти на всій
      // сторінці. Тому висоту ведемо переходом, а плитки заходять хвилею.
      morphHeight(box, () => {
        box.textContent = "";
        slotEls = [];

        if (!day) {
          const empty = document.createElement("p");
          empty.className = "empty";
          empty.textContent = "Оберіть день у календарі — тут з'являться вільні години.";
          box.append(empty);
          return;
        }

        day.slots.forEach((s, i) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = `slot ${s.free ? "free" : s.why === "past" ? "past" : "busy"}`;
          b.style.setProperty("--i", String(i));
          b.textContent = s.time;
          b.disabled = !s.free;
          b.title = s.free ? "вільно" : s.why === "past" ? "час уже минув" : "зайнято";
          if (s.free) {
            b.dataset.k = `slot-${s.time}`;
            b.onclick = () => {
              state.time = s.time;
              paint();
            };
            slotEls.push({ el: b, time: s.time });
          }
          box.append(b);
        });
      });
    }

    for (const { el, time } of slotEls) {
      const sel = state.time === time;
      el.classList.toggle("sel", sel);
      el.setAttribute("aria-pressed", String(sel));
    }
  }

  /* ── підсумок і кнопка ───────────────────────────────────────────────── */
  function paintFoot() {
    const day = current();
    const svc = state.svc === null ? null : business.services[state.svc];
    const unit = state.unit === null ? null : business.units[state.unit];
    const ready = !!svc && !!unit && !!day && !!state.time;

    const mark = (id, text, filled) => {
      $(id).textContent = text;
      $(id).className = `pick${filled ? " on" : ""}`;
    };
    mark("p-service", svc ? svc.name : "оберіть", !!svc);
    mark("p-unit", unit ? unit.name : "оберіть", !!unit);
    mark("p-day", day ? relDayLabel(day.date, today) : "оберіть", !!day);

    const typed = $("nm").value.trim();
    mark("p-name", typed || "заповніть", !!typed);

    // Підсумок читається зверху вниз: спершу ХТО записується, потім НА ЩО.
    // Так людина впізнає в ньому себе, а не лише перелік своїх кліків.
    const sum = $("sum");
    sum.textContent = "";
    if (!svc) sum.textContent = "Оберіть послугу, щоб побачити ціну й вільний час.";
    else if (!unit) sum.textContent = "Оберіть пост.";
    else if (!day) sum.textContent = "Оберіть день.";
    else if (!state.time) sum.textContent = "Оберіть час — і можна записуватись.";
    else {
      const name = normalizeName($("nm").value);
      const phone = normalizePhone($("ph").value);
      const who = [name.ok ? name.value : null, phone.ok ? prettyPhone(phone.value) : null].filter(Boolean);
      if (who.length) {
        const line = document.createElement("div");
        line.className = "sum-who";
        line.textContent = who.join(" · ");
        sum.append(line);
      }
      const what = document.createElement("div");
      what.className = "sum-what";
      what.textContent = `${svc.name} · ${shortDate(day.date)} о ${state.time} · ${unit.name}`;
      sum.append(what);
    }

    $("go").disabled = !ready || state.sending;
    $("go").textContent = state.sending ? "Записуємо…" : "Записатись";
  }

  /* ── супровід кроками ────────────────────────────────────────────────── */
  const stepEls = [...root.querySelectorAll(".step[data-step]")];
  const calm = calmMotion();
  const scroller = createScroller();
  const ribbon = root.querySelector(".ribbon");
  /** Липка демо-стрічка закриває верх екрана — під неї й ведемо крок. */
  const topInset = () => (ribbon ? ribbon.getBoundingClientRect().height : 0);
  let lastActive = -1;
  let settled = false;   // на першій відмальовці нікуди не веземо

  /**
   * Доводимо до наступного кроку.
   *
   * Їдемо одразу, не чекаючи: затримка читалась як «сторінка задумалась».
   * Списки в цю мить ще згортаються, тому ціль перераховується щокадру —
   * цим займається motion.js, а куди саме ставити крок, рахує core/scroll.js:
   * влазить — по центру вільного місця, не влазить — заголовком під стрічку.
   */
  function reveal(el) {
    if (calm) return;
    glideToStep(scroller, el, topInset);
  }

  function paintGuide() {
    const states = stepStates({
      service: state.svc !== null,
      unit: state.unit !== null,
      day: !!state.key,
      time: !!state.time,
      contact: normalizeName($("nm").value).ok && normalizePhone($("ph").value).ok,
    });

    states.forEach((st, i) => {
      const el = stepEls[i];
      if (!el) return;
      el.classList.toggle("active", st === "active");
      el.classList.toggle("done", st === "done");
      if (st === "active") el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");

      const num = el.querySelector(".num");
      num.classList.toggle("ok", st === "done");
      const want = st === "done" ? NUM_TICK : String(i + 1);
      if (num.innerHTML !== want) num.innerHTML = want;
      num.setAttribute("aria-label", st === "done" ? `Крок ${i + 1}, виконано` : `Крок ${i + 1}`);

      // Текст лишається на місці завжди — показує чи ховає його CSS. Якби ми
      // стирали рядок, він зникав би ривком, без жодного переходу.
      const hint = el.querySelector(".hint span");
      if (hint.textContent !== STEP_HINT[i]) hint.textContent = STEP_HINT[i];
    });

    // Смужка прогресу. Назву кроку беремо з його ж заголовка — щоб не тримати
    // ті самі слова у двох місцях і щоб «Пост» брався з даних закладу.
    const now = activeStep(states);
    const doneCount = states.filter((st) => st === "done").length;
    $("bar").style.width = `${Math.round((doneCount / states.length) * 100)}%`;
    $("plab").innerHTML = "";
    if (now === -1) {
      $("plab").textContent = "Усе заповнено — можна записуватись";
    } else {
      const title = stepEls[now].querySelector("h2").textContent;
      const lead = document.createTextNode(`Крок ${now + 1} з ${states.length} · `);
      const name = document.createElement("b");
      name.textContent = title;
      $("plab").append(lead, name);
    }

    if (settled && now !== lastActive && now !== -1) reveal(stepEls[now]);
    lastActive = now;
    settled = true;
  }

  function paint() {
    // Здебільшого кнопки переживають клік і фокус лишається сам. Але зміна
    // дня чи місяця таки будує нові — тоді повертаємо фокус на ту саму, інакше
    // він падає на початок сторінки.
    const held = root.activeElement && root.activeElement.dataset ? root.activeElement.dataset.k : null;

    syncService();
    syncUnits();
    syncQuick();
    syncCalendar();
    syncSlots();
    paintFoot();
    paintGuide();

    if (held) {
      const back = root.querySelector(`[data-k="${held}"]`);
      // preventScroll — інакше повернення фокусу саме й смикає сторінку, і то
      // просто посеред нашої плавної подорожі до наступного кроку.
      if (back && back !== root.activeElement) back.focus({ preventScroll: true });
    }
  }

  /* ── помилки полів ───────────────────────────────────────────────────── */
  function showError(input, box, result) {
    box.querySelector("span").textContent = result.ok ? "" : result.error;
    box.hidden = result.ok;
    input.classList.toggle("bad", !result.ok);
    input.setAttribute("aria-invalid", String(!result.ok));
    return result.ok;
  }

  function clearError(input, box) {
    box.hidden = true;
    input.classList.remove("bad");
    input.setAttribute("aria-invalid", "false");
  }

  $("nm").oninput = () => {
    clearError($("nm"), $("nm-err"));
    paintFoot();
    paintGuide();
  };
  $("ph").oninput = () => {
    clearError($("ph"), $("ph-err"));
    paintFoot();      // номер теж іде в підсумок, тож його треба перемалювати
    paintGuide();
  };

  /* ── відправлення ────────────────────────────────────────────────────── */
  $("go").onclick = async () => {
    const name = normalizeName($("nm").value);
    const phone = normalizePhone($("ph").value);
    // Обидві перевірки виконуються завжди: людина має побачити всі помилки
    // за один раз, а не виправляти поля по черзі.
    const nameOk = showError($("nm"), $("nm-err"), name);
    const phoneOk = showError($("ph"), $("ph-err"), phone);
    if (!nameOk || !phoneOk) {
      // Поле з помилкою показуємо тією ж плавною подорожжю, що й кроки, а не
      // ривком браузера: focus() без preventScroll кидає сторінку миттєво.
      $(nameOk ? "ph" : "nm").focus({ preventScroll: true });
      reveal(stepEls[4]);
      return;
    }

    state.sending = true;
    paintFoot();

    const day = current();
    try {
      const res = await adapter.submit({
        name: name.value,
        phone: phone.value,
        service: business.services[state.svc].name,
        unit: business.units[state.unit].name,
        date: day.date,
        time: state.time,
      });
      celebrate(day, () => {
        renderDone(day, res);
        window.scrollTo({ top: 0, behavior: "auto" });
      });
    } catch {
      state.sending = false;
      paintFoot();
      $("sum").textContent = "Не вдалось записати. Перевірте зв'язок і спробуйте ще раз.";
    }
  };

  /**
   * Повноекранне «Записано».
   *
   * Кнопку тиснуть унизу сторінки. Якщо малювати галочку вгорі, людина її не
   * побачить: поки доїде — усе скінчилось. Тому святкуємо там, де вона зараз,
   * а сторінку під сплешем перемотуємо миттєво, без плавності — її все одно
   * не видно, зате нічого не смикається, коли сплеш іде.
   */
  function celebrate(day, then) {
    scroller.stop();     // подорож до кроку більше не має сенсу — усе зроблено
    if (calm) {          // просили менше руху — не влаштовуємо вистав
      then();
      return;
    }

    const splash = document.createElement("div");
    splash.className = "splash";
    splash.setAttribute("role", "status");
    splash.innerHTML =
      `<div class="big-tick">${XL_TICK}</div>` +
      '<div class="splash-t">Записано</div><div class="splash-s"></div>';
    splash.querySelector(".splash-s").textContent = `${shortDate(day.date)}, ${state.time}`;
    document.body.append(splash);

    setTimeout(() => {
      then();
      splash.classList.add("out");
      setTimeout(() => splash.remove(), 420);
    }, 1550);
  }

  /* ── екран підтвердження ─────────────────────────────────────────────── */
  function renderDone(day, res) {
    const box = $("done");
    box.textContent = "";

    const tick = document.createElement("div");
    tick.className = "tick";
    tick.innerHTML = BIG_TICK;

    const h = document.createElement("h2");
    h.textContent = `Записано на ${shortDate(day.date)}, ${state.time}`;

    const lead = document.createElement("div");
    lead.className = "lead";
    lead.textContent = res.sent
      ? "Підтвердження вже надіслано."
      : "Ось що відбувається в цю ж секунду — без участі адміністратора";

    const msgs = document.createElement("div");
    msgs.className = "msgs";

    for (const m of res.messages) {
      const p = m.parts;
      const when = typeof m.when === "string" ? m.when : `${shortDate(m.when)}, ${pad(m.when.getHours())}:00`;

      const item = document.createElement("div");
      item.innerHTML =
        '<div class="msg-head"></div>' +
        '<div class="row"><span class="av"></span><div class="bubble">' +
        '<div class="sender"></div><div class="m-title"></div><div class="m-lines"></div>' +
        '</div></div>';

      item.querySelector(".msg-head").textContent = `${p.who} · ${when}`;
      item.querySelector(".av").textContent = p.avatar;
      item.querySelector(".sender").textContent = p.sender;
      item.querySelector(".m-title").textContent = p.title;

      const lines = item.querySelector(".m-lines");
      for (const line of p.lines) {
        const s = document.createElement("span");
        s.textContent = line;
        lines.append(s);
      }

      const bubble = item.querySelector(".bubble");
      if (m.to === "client") bubble.classList.add("tint");
      if (p.foot) {
        const f = document.createElement("div");
        f.className = "m-foot";
        f.textContent = p.foot;
        bubble.append(f);
      }
      // Кнопки нагадування. Це малюнок повідомлення, а не робочий інтерфейс,
      // тому спани, а не кнопки: тиснути тут нема на що.
      if (p.buttons) {
        const row = document.createElement("div");
        row.className = "m-btns";
        for (const label of p.buttons) {
          const b = document.createElement("span");
          b.className = "m-btn";
          b.textContent = label;
          row.append(b);
        }
        bubble.append(row);
      }

      const stamp = document.createElement("div");
      stamp.className = "stamp";
      stamp.textContent = typeof m.when === "string" ? "зараз" : when;
      bubble.append(stamp);

      msgs.append(item);
    }

    const again = document.createElement("button");
    again.type = "button";
    again.className = "again";
    again.textContent = "Пройти ще раз";
    again.onclick = () => location.reload();

    const top = document.createElement("div");
    top.className = "done-top";
    top.append(tick, h, lead);
    box.append(top, msgs, again);
    $("flow").hidden = true;
    box.hidden = false;
  }

  buildService();
  buildUnits();
  loadDays().then(paint);
}
