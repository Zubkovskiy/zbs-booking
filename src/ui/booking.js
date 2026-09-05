// Складання сторінки. Тут тільки DOM і стан екрана.
// Усе, що можна порахувати без браузера, живе в core/ і покрите тестами.
//
// ЖОДЕН блок не перемальовується без потреби: послуги, пости, ярлики днів,
// сітка календаря і плитки часу будуються один раз, далі лише синхронізуються.
// Перемальовування вбивало кожен перехід (нова кнопка не має від чого
// анімуватись), губило фокус із клавіатури і давало смиканину на кожен клік.

import { nextDays, countFree, bestDayIndex, dayKey, monthGrid, monthIndex, isWorkday, groupByPartOfDay, ticketCode } from "../core/schedule.js";
import { shortDate, dayWithWeekday, relLongDayLabel, monthTitle, freeLabel, busyReason, durationLabel, plural, WEEKDAY_HEAD } from "../core/format.js";
import { normalizeName, normalizePhone, prettyPhone } from "../core/validate.js";
import { stepStates, activeStep, openStep, STEP_HINT } from "../core/guide.js";
import { createScroller, glideToStep, morphHeight, calmMotion } from "./motion.js";

/** На скільки днів уперед відкритий запис. Три місяці — щоб при щільному
    записі було куди гортати, а не впертись у край вікна. */
const DAYS_AHEAD = 90;

const TICK = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const NUM_TICK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const BIG_TICK = '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
const READ_TICK = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m1 13 4 4L14 8"/><path d="m9 13 4 4L22 8"/></svg>';
const STAR = '<svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true"><path d="m12 2 2.9 6.3 6.6.8-4.9 4.6 1.3 6.8L12 17.3 6.1 20.5l1.3-6.8L2.5 9.1l6.6-.8z"/></svg>';
const ANY_UNIT = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 20v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1"/><circle cx="7.5" cy="7" r="3.2"/><path d="M16 15.2a4 4 0 0 1 6 3.5V20"/><circle cx="16.8" cy="7.4" r="2.8"/></svg>';

const pad = (n) => String(n).padStart(2, "0");

/** Скільки триває згортання кроку. Мусить збігатися з --t-fold у booking.css:
    висоти, які їдуть одночасно, мають їхати однаково довго — інакше в кінці
    переходу одна встигає, а друга ще доповзає, і блок смикається наостанок. */
const FOLD_MS = 600;

/** Ініціали для аватара поста: «Пост діагностики» → «ПД». */
function initials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join("");
}

export function mountBooking(root, business, adapter) {
  const $ = (id) => root.getElementById(id);

  /* ── шапка ───────────────────────────────────────────────────────────── */
  $("b-logo").textContent = business.name.slice(0, 1);
  $("b-name").textContent = business.name;
  $("b-sub").textContent = `Онлайн-запис · ${business.address}`;
  $("unit-title").textContent = business.unitTitle ?? "Майстер";
  $("sig").textContent = business.signature ?? "";
  // Кнопка дзвінка — тільки якщо телефон справді є в профілі. Порожня кнопка
  // «подзвонити» гірша за її відсутність.
  if (business.phone) {
    $("b-call").href = `tel:${business.phone.replace(/[^\d+]/g, "")}`;
    $("b-call").hidden = false;
  }

  const state = {
    svc: null,
    unit: null,
    key: null,
    view: null,      // {y, m} — який місяць показує календар
    time: null,
    open: null,      // крок, який людина відкрила сама; null — ведемо по порядку
    remind: true,    // нагадування за добу; людина може вимкнути
    sending: false,
  };

  /** Вікно запису: 90 днів із розкладом. Перебудовується при зміні поста. */
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
  const chosenSvc = () => (state.svc === null ? null : business.services[state.svc]);
  const chosenUnit = () => (state.unit === null ? null : business.units[state.unit]);

  /* Рух вмикається не одразу, і це найдешевший спосіб прибрати «рвано» на
     першому розгортанні. Дві причини, обидві не залежать від нашого коду:
     перша відмальовка будує все з нуля, а шрифти приїжджають пізніше й
     підміняють гарнітуру просто посеред переходу — блок доїжджає не туди,
     звідки починав. Доки не сталось і те, і те, сторінка стоїть. */
  root.documentElement.classList.add("still");
  let painted = false;
  let fontsOk = false;
  let ready = false;

  function arm() {
    if (!painted || !fontsOk || ready) return;
    ready = true;
    root.documentElement.classList.remove("still");
  }

  (document.fonts && document.fonts.ready ? document.fonts.ready : Promise.resolve())
    .then(() => { fontsOk = true; requestAnimationFrame(arm); });

  /** Змінити вміст блока з переходом висоти — коли для переходу є всі умови. */
  function grow(box, mutate) {
    if (ready) morphHeight(box, mutate, FOLD_MS);
    else mutate();
  }

  function pickDay(day) {
    state.key = day.key;
    state.time = null;
    state.view = { y: day.date.getFullYear(), m: day.date.getMonth() };
    state.open = null;
    paint();
  }

  /* ── крок 1: послуга ─────────────────────────────────────────────────── */
  const svcOpts = [];

  function buildService() {
    const box = $("services");

    business.services.forEach((s, i) => {
      const opt = document.createElement("button");
      opt.type = "button";
      opt.className = "opt";
      opt.setAttribute("role", "option");
      opt.innerHTML =
        '<span class="t-txt"><span class="t-name"></span><span class="t-note"></span></span>' +
        `<span class="price"></span><span class="dot">${TICK}</span>`;
      opt.querySelector(".t-name").textContent = s.name;
      opt.querySelector(".t-note").textContent = s.note ?? "";
      opt.querySelector(".price").textContent = s.price ?? "";
      opt.onclick = () => {
        state.svc = i;
        state.open = null;      // вибір зроблено — ведемо далі, а не лишаємось тут
        paint();
      };
      svcOpts.push(opt);
      box.append(opt);
    });
    box.setAttribute("role", "listbox");
  }

  function syncService() {
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
      card.className = "opt";
      card.innerHTML =
        '<span class="av"></span>' +
        '<span class="t-txt"><span class="t-name"></span><span class="t-note"></span></span>' +
        '<span class="rate" hidden></span>';
      // «Будь-який вільний» — це не людина і не пост, тому в нього значок, а не
      // ініціали: інакше аватар «БВ» читається як ще один майстер.
      const av = card.querySelector(".av");
      if (u.id === "any") av.innerHTML = ANY_UNIT;
      else av.textContent = initials(u.name);
      card.querySelector(".t-name").textContent = u.name;
      card.querySelector(".t-note").textContent = u.note ?? "";
      // Рейтинг показуємо, тільки якщо він справді є в профілі закладу.
      // Вигаданий рейтинг у демо для чужого бізнесу — це те саме, що вигадана
      // ціна: власник побачить його першим і перестане вірити всьому решті.
      if (u.rating) {
        const rate = card.querySelector(".rate");
        rate.hidden = false;
        rate.innerHTML = `${STAR}<b></b>`;
        // Один знак після коми завжди: «5» поруч із «4.9» читається як інша
        // шкала, а не як вищий бал.
        rate.querySelector("b").textContent = Number(u.rating).toFixed(1);
        rate.setAttribute("aria-label", `рейтинг ${u.rating}`);
      }
      card.onclick = async () => {
        const changed = state.unit !== i;
        state.unit = i;
        state.open = null;
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
  function monthOf(day) {
    return monthIndex(day.date.getFullYear(), day.date.getMonth());
  }

  let calMonth = null;
  let calCells = [];
  let headBuilt = false;

  /** Сітка перебудовується ЛИШЕ при зміні місяця. Вибір дня і зміна поста —
      це оновлення класів на тих самих кнопках, тому підсвітка перетікає
      переходом, а не блимає новою кнопкою. */
  function syncCalendar() {
    const { y, m } = state.view;
    const first = days[0];
    const last = days[days.length - 1];
    const shown = monthIndex(y, m);

    $("month").textContent = monthTitle(y, m);
    $("prev").disabled = shown <= monthIndex(first.date.getFullYear(), first.date.getMonth());
    $("next").disabled = shown >= monthIndex(last.date.getFullYear(), last.date.getMonth());
    $("prev").onclick = () => shiftMonth(-1);
    $("next").onclick = () => shiftMonth(1);

    if (!headBuilt) {
      headBuilt = true;
      const head = $("wd");
      WEEKDAY_HEAD.forEach((t) => {
        const s = document.createElement("span");
        s.textContent = t;
        head.append(s);
      });
    }

    const grid = $("days");
    if (calMonth !== shown) {
      const dir = calMonth === null ? 0 : Math.sign(shown - calMonth);
      calMonth = shown;
      // Клітинки вдягаємо ТУТ ЖЕ, всередині: висоту міряють одразу після цього,
      // а гола кнопка без класу вдвічі нижча за справжню — сітка поїхала б у
      // неправильний бік і клацнула назад у кінці переходу.
      grow(grid, () => {
        grid.textContent = "";
        calCells = [];
        for (const cell of monthGrid(y, m)) {
          const b = document.createElement("button");
          b.type = "button";
          b.innerHTML = '<span class="n"></span><span class="dot-d"></span>';
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

  function dressCells() {
    for (const { el, date } of calCells) {
      const day = byKey.get(dayKey(date));
      const kind = !day ? "out" : day.free > 0 ? "free" : "none";
      const sel = !!day && day.key === state.key;

      // Сьогодні позначаємо завжди — від нього людина рахує «як швидко можна».
      const isToday = dayKey(date) === dayKey(today);
      el.className = `cell ${kind}${sel ? " sel" : ""}${isToday ? " today" : ""}`;
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
  let slotsSig = null;
  let slotEls = [];

  /** Плитки перебудовуються тільки коли змінився день або пост. Натискання на
      час — це один клас, тож обрана плитка заливається переходом, а сітка під
      пальцем не мигає й не переїжджає. */
  function syncSlots() {
    const day = current();
    const box = $("slots");

    $("slots-note").textContent = day
      ? `Тривалість візиту: ${durationLabel(business.hours.stepMin)}${business.openLine ? ` · ${business.openLine}` : ""}`
      : "";

    const sig = day ? `${state.unit}|${day.key}|${day.slots.map((s) => s.time + (s.free ? "+" : "-")).join(",")}` : "";
    if (sig !== slotsSig) {
      slotsSig = sig;
      // Порожньо → повна сітка годин — це найбільший стрибок висоти на всій
      // сторінці. Тому висоту ведемо переходом, а плитки заходять хвилею.
      grow(box, () => {
        box.textContent = "";
        slotEls = [];

        if (!day) {
          const empty = document.createElement("p");
          empty.className = "empty";
          empty.textContent = "Оберіть день у календарі — тут з'являться вільні години.";
          box.append(empty);
          return;
        }

        let i = 0;
        for (const group of groupByPartOfDay(day.slots)) {
          const wrap = document.createElement("div");
          wrap.className = "sgroup";
          const head = document.createElement("div");
          head.className = "sgroup-h";
          head.textContent = group.label;
          const grid = document.createElement("div");
          grid.className = "sgrid";

          for (const s of group.slots) {
            const b = document.createElement("button");
            b.type = "button";
            b.className = "slot";
            b.style.setProperty("--i", String(i++));
            b.textContent = s.time;
            b.disabled = !s.free;
            b.title = s.free ? "вільно" : s.why === "past" ? "час уже минув" : "зайнято";
            if (s.free) {
              b.dataset.k = `slot-${s.time}`;
              b.onclick = () => {
                state.time = s.time;
                state.open = null;
                paint();
              };
              slotEls.push({ el: b, time: s.time });
            }
            grid.append(b);
          }

          wrap.append(head, grid);
          box.append(wrap);
        }
      });
    }

    for (const { el, time } of slotEls) {
      const sel = state.time === time;
      el.classList.toggle("sel", sel);
      el.setAttribute("aria-pressed", String(sel));
    }
  }

  /* ── панель із ціною і кнопкою ───────────────────────────────────────── */
  function paintBar() {
    const day = current();
    const svc = chosenSvc();
    const unit = chosenUnit();
    const name = normalizeName($("nm").value);
    const phone = normalizePhone($("ph").value);
    const ready = !!svc && !!unit && !!day && !!state.time;

    // Рядок під назвою кроку: поки не обрано — що тут робити, коли обрано —
    // сам вибір. Це єдине, що лишається на екрані від згорнутого кроку.
    const mark = (id, text, i) => {
      const el = $(id);
      el.textContent = text || STEP_HINT[i];
    };
    mark("p-service", svc ? [svc.name, svc.price].filter(Boolean).join(" · ") : "", 0);
    mark("p-unit", unit ? unit.name : "", 1);
    mark("p-day", day ? dayWithWeekday(day.date, today) : "", 2);
    mark("p-time", state.time ?? "", 3);
    mark("p-name", [name.ok ? name.value : null, phone.ok ? prettyPhone(phone.value) : null].filter(Boolean).join(" · "), 4);

    const total = svc ? (svc.price ?? "за оглядом") : "0 ₴";
    $("bar-total").textContent = total;
    $("aside-total").textContent = total;

    // Бічна колонка каже те саме, але розгорнуто: три рядки, кожен або з
    // вибором, або з чесним «не обрано».
    const rows = [
      ["Послуга", svc ? svc.name : null],
      ["Коли", day && state.time ? `${dayWithWeekday(day.date, today)}, ${state.time}` : day ? dayWithWeekday(day.date, today) : null],
      [business.unitTitle ?? "Майстер", unit ? unit.name : null],
    ];
    const box = $("aside-rows");
    box.textContent = "";
    for (const [k, v] of rows) {
      const row = document.createElement("div");
      const kk = document.createElement("div");
      kk.className = "k";
      kk.textContent = k;
      const vv = document.createElement("div");
      vv.className = v ? "v" : "v none";
      vv.textContent = v ?? "не обрано";
      row.append(kk, vv);
      box.append(row);
    }
    // Назву наступного кроку беремо з його ж заголовка і НЕ відмінюємо:
    // «оберіть майстер» звучить як помилка, а «Майстер / Пост / Лікар»
    // підставляється з даних закладу і в знахідний відмінок не поставиш.
    const nextStep = [!svc, !unit, !day, !state.time].indexOf(true);
    $("bar-meta").textContent = nextStep === -1
      ? `${shortDate(day.date)}, ${state.time}`
      : `далі: ${stepEls[nextStep].querySelector(".ttl").textContent}`;

    // Кнопка ніколи не буває мертвою: поки заповнено не все, вона веде до
    // наступного кроку. Сіра кнопка на пів екрана нічого не пояснює — людина
    // тисне її першою і не розуміє, чому нічого не сталось.
    allReady = ready;
    const label = state.sending ? "Записуємо…" : ready ? "Записатись" : "Далі";
    for (const id of ["go", "go-wide"]) {
      $(id).disabled = state.sending;
      $(id).textContent = label;
    }
  }

  let allReady = false;

  /* ── супровід кроками ────────────────────────────────────────────────── */
  const stepEls = [...root.querySelectorAll(".step[data-step]")];
  const calm = calmMotion();
  const scroller = createScroller();
  /** Скільки зверху з'їдає липка шапка. Липкого нічого немає, але правило
      прокрутки вміє з нею жити, тому місце лишаємо. */
  const topInset = () => 0;
  let lastOpen = -1;
  let settled = false;

  /**
   * Доводимо до кроку, який щойно відкрився.
   *
   * Правило руху одне: рухатись рівно стільки, скільки треба. Видно — стоїмо;
   * нижній край за екраном — підтягуємо рівно до нього. Через це верх блока
   * лишається на місці, а розгортається тільки низ.
   */
  function reveal(el) {
    if (calm) return;
    glideToStep(scroller, el, topInset);
  }

  /**
   * Заголовок кроку — кнопка. Пройдений крок нею відкривають назад, щоб
   * змінити вибір; повторне натискання повертає до звичайного ходу. Кроки, до
   * яких людина ще не дійшла, не відкриваються: розклад залежить від поста, і
   * стрибок уперед показав би час, якого може не бути.
   */
  function wireHeads() {
    stepEls.forEach((el, i) => {
      el.querySelector(".step-btn").onclick = () => {
        state.open = state.open === i ? null : i;
        paint();
      };
    });
  }

  function paintGuide() {
    const states = stepStates({
      service: state.svc !== null,
      unit: state.unit !== null,
      day: !!state.key,
      time: !!state.time,
      contact: normalizeName($("nm").value).ok && normalizePhone($("ph").value).ok,
    });

    const open = openStep(states, state.open);

    states.forEach((st, i) => {
      const el = stepEls[i];
      if (!el) return;
      el.classList.toggle("done", st === "done");
      el.classList.toggle("open", i === open);
      if (st === "active") el.setAttribute("aria-current", "step");
      else el.removeAttribute("aria-current");

      const btn = el.querySelector(".step-btn");
      btn.setAttribute("aria-expanded", String(i === open));
      btn.disabled = st === "todo" && i !== open;

      // Кружок перемальовуємо, ТІЛЬКИ коли він справді міняє вигляд.
      // Порівнювати innerHTML із рядком SVG не можна: браузер серіалізує
      // <path/> як <path></path>, рядки ніколи не збігаються — і галочка
      // домальовувалась заново в усіх пройдених кроках на кожен клік.
      const num = el.querySelector(".num");
      num.classList.toggle("ok", st === "done");
      const mark = st === "done" ? "tick" : "num";
      if (num.dataset.mark !== mark) {
        num.dataset.mark = mark;
        num.innerHTML = mark === "tick" ? NUM_TICK : String(i + 1);
      }
      num.setAttribute("aria-label", st === "done" ? `Крок ${i + 1}, виконано` : `Крок ${i + 1}`);
    });

    const now = activeStep(states);
    const doneCount = states.filter((st) => st === "done").length;
    $("bar").style.width = `${Math.round((doneCount / states.length) * 100)}%`;
    $("plab").textContent = now === -1 ? "готово" : `${now + 1}/${states.length}`;

    // Веземо до того кроку, який ВІДКРИВСЯ, а не до наступного за списком:
    // коли людина сама повернулась щось змінити, дивитись вона має туди.
    if (settled && open !== lastOpen) reveal(stepEls[open]);
    lastOpen = open;
    settled = true;
  }

  function paint() {
    // Здебільшого кнопки переживають клік і фокус лишається сам. Але зміна дня
    // чи місяця таки будує нові — тоді повертаємо фокус на ту саму.
    const held = root.activeElement && root.activeElement.dataset ? root.activeElement.dataset.k : null;

    syncService();
    syncUnits();
    syncCalendar();
    syncSlots();
    paintBar();
    paintGuide();

    if (!painted) {
      painted = true;
      requestAnimationFrame(arm);
    }

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

  $("remind-sub").textContent = "Нагадаємо за добу до візиту";
  $("remind").onclick = () => {
    state.remind = !state.remind;
    syncRemind();
  };
  function syncRemind() {
    $("remind").classList.toggle("on", state.remind);
    $("remind").setAttribute("aria-pressed", String(state.remind));
  }
  syncRemind();

  $("nm").oninput = () => {
    clearError($("nm"), $("nm-err"));
    paintBar();
    paintGuide();
  };
  $("ph").oninput = () => {
    clearError($("ph"), $("ph-err"));
    paintBar();
    paintGuide();
  };

  /* ── відправлення ────────────────────────────────────────────────────── */
  async function go() {
    if (!allReady) {
      // Повертаємось до звичайного ходу і ведемо до першого незаповненого.
      state.open = null;
      paint();
      reveal(stepEls[lastOpen]);
      return;
    }

    const name = normalizeName($("nm").value);
    const phone = normalizePhone($("ph").value);
    // Обидві перевірки виконуються завжди: людина має побачити всі помилки
    // за один раз, а не виправляти поля по черзі.
    const nameOk = showError($("nm"), $("nm-err"), name);
    const phoneOk = showError($("ph"), $("ph-err"), phone);
    if (!nameOk || !phoneOk) {
      $(nameOk ? "ph" : "nm").focus({ preventScroll: true });
      reveal(stepEls[4]);
      return;
    }

    state.sending = true;
    paintBar();

    const day = current();
    try {
      const res = await adapter.submit({
        name: name.value,
        phone: phone.value,
        service: chosenSvc().name,
        unit: chosenUnit().name,
        date: day.date,
        time: state.time,
        remind: state.remind,
      });
      scroller.stop();
      renderDone(day, res, phone.value);
      window.scrollTo({ top: 0, behavior: "auto" });
    } catch {
      state.sending = false;
      paintBar();
      $("bar-meta").textContent = "не вдалось — спробуйте ще раз";
    }
  }
  $("go").onclick = go;
  $("go-wide").onclick = go;

  /* ── екран підтвердження ─────────────────────────────────────────────── */

  /**
   * Три повідомлення розкладаємо по двох переписках: те, що бачить клієнт у
   * своєму телефоні, і те, що падає адміністратору. Саме це ми й продаємо, тож
   * показуємо не «повідомлення в рамці», а те, як воно виглядатиме насправді.
   */
  function chatsOf(messages) {
    const chats = [];
    for (const m of messages) {
      let chat = chats.find((c) => c.to === m.to);
      if (!chat) {
        chat = {
          to: m.to,
          name: m.parts.sender,
          avatar: m.parts.avatar,
          sub: "бот",
          tag: m.to === "admin" ? "ваш телефон" : "телефон клієнта",
          items: [],
        };
        chats.push(chat);
      }
      chat.items.push(m);
    }
    return chats;
  }

  /** Коли повідомлення прийшло: «одразу» — це зараз, решта має свою дату. */
  function stampOf(when, now) {
    const at = typeof when === "string" ? now : when;
    return {
      day: typeof when === "string" ? "сьогодні" : relLongDayLabel(at, today),
      time: `${pad(at.getHours())}:${pad(at.getMinutes())}`,
    };
  }

  function renderChat(chat, now, i) {
    const box = document.createElement("section");
    box.className = "chat";
    box.style.setProperty("--i", String(i));

    const top = document.createElement("div");
    top.className = "chat-top";
    top.innerHTML =
      '<span class="chat-av"></span>' +
      '<span class="chat-id"><b></b><i></i></span>' +
      '<span class="chat-tag"></span>';
    top.querySelector(".chat-av").textContent = chat.avatar;
    top.querySelector(".chat-id b").textContent = chat.name;
    top.querySelector(".chat-id i").textContent = chat.sub;
    top.querySelector(".chat-tag").textContent = chat.tag;

    const feed = document.createElement("div");
    feed.className = "feed";

    let lastDay = null;
    for (const m of chat.items) {
      const stamp = stampOf(m.when, now);
      const wrap = document.createElement("div");

      // Роздільник дня — як у месенджері: тільки коли день змінився.
      if (stamp.day !== lastDay) {
        lastDay = stamp.day;
        const sep = document.createElement("div");
        sep.className = "tg-day";
        const pill = document.createElement("span");
        pill.textContent = stamp.day;
        sep.append(pill);
        wrap.append(sep);
      }

      const bubble = document.createElement("div");
      bubble.className = "tg-b";

      const title = document.createElement("div");
      title.className = "tg-t";
      title.textContent = m.parts.title;
      bubble.append(title);

      if (m.parts.lines.length) {
        const lines = document.createElement("div");
        lines.className = "tg-l";
        for (const line of m.parts.lines) {
          const span = document.createElement("span");
          span.textContent = line;
          lines.append(span);
        }
        bubble.append(lines);
      }

      if (m.parts.foot) {
        const foot = document.createElement("div");
        foot.className = "tg-f";
        foot.textContent = m.parts.foot;
        bubble.append(foot);
      }

      const time = document.createElement("div");
      time.className = "tg-time";
      time.innerHTML = `<span>${stamp.time}</span>${READ_TICK}`;
      bubble.append(time);
      wrap.append(bubble);

      // Кнопки бота справжні — і це навмисно: власник має сам натиснути й
      // побачити, що відповідь клієнта це один дотик, а не дзвінок.
      if (m.parts.buttons) {
        const kb = document.createElement("div");
        kb.className = "tg-kb";
        const note = document.createElement("div");
        note.className = "tg-note";
        const picks = [];

        for (const label of m.parts.buttons) {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "tg-btn";
          b.textContent = label;
          b.onclick = () => {
            for (const other of picks) other.classList.toggle("on", other === b);
            note.textContent = label === m.parts.buttons[0]
              ? "Готово. Адміністратор бачить підтвердження — дзвонити нікому не треба."
              : "Готово. Година звільнилась, адміністратор уже бачить це.";
            note.classList.add("on");
          };
          picks.push(b);
          kb.append(b);
        }
        wrap.append(kb, note);
      }

      feed.append(wrap);
    }

    box.append(top, feed);
    return box;
  }

  /** Талон. Те, що можна показати на стійці, читається як «запис існує», а не
      як чергове повідомлення про успіх. */
  function renderTicket(day) {
    const svc = chosenSvc();
    const unit = chosenUnit();
    const no = ticketCode(`${day.key}|${state.time}|${svc.name}|${unit.name}`);

    const box = document.createElement("div");
    box.className = "ticket";
    box.innerHTML =
      '<div class="ticket-h">' +
        '<div class="ticket-top">' +
          '<div style="flex:1;min-width:0">' +
            '<div class="eyebrow">Талон запису</div><div class="ticket-name"></div>' +
          '</div>' +
          '<div class="ticket-price"><b></b><span>на місці</span></div>' +
        '</div>' +
        '<div class="ticket-chips"></div>' +
      '</div>' +
      '<div class="perf"><i></i><b></b><i></i></div>' +
      '<div class="ticket-grid"></div>';

    box.querySelector(".ticket-name").textContent = svc.name;
    box.querySelector(".ticket-price b").textContent = svc.price ?? "за оглядом";

    const chips = box.querySelector(".ticket-chips");
    for (const text of [`№ ${initials(business.name)}-${no}`, durationLabel(business.hours.stepMin), unit.name]) {
      const s = document.createElement("span");
      s.textContent = text;
      chips.append(s);
    }

    const grid = box.querySelector(".ticket-grid");
    const cells = [
      ["Коли", `${dayWithWeekday(day.date, today)}, ${state.time}`],
      [business.unitTitle ?? "Майстер", unit.name],
      ["Адреса", business.address],
    ];
    cells.forEach(([k, v], i) => {
      const cell = document.createElement("div");
      if (i === cells.length - 1 && cells.length % 2) cell.style.gridColumn = "1 / -1";
      const kk = document.createElement("div");
      kk.className = "k";
      kk.textContent = k;
      const vv = document.createElement("div");
      vv.className = "v";
      vv.textContent = v;
      cell.append(kk, vv);
      grid.append(cell);
    });

    return box;
  }

  function renderDone(day, res, phone) {
    const box = $("done");
    box.textContent = "";
    const now = new Date();

    const top = document.createElement("div");
    top.className = "done-top";
    top.innerHTML = `<div class="big-ok">${BIG_TICK}</div><h2>Вас записано</h2><div class="lead"></div>`;
    top.querySelector(".lead").textContent = res.sent
      ? `Підтвердження надіслали на ${prettyPhone(phone)}`
      : "Ось що прийшло б у цю ж секунду — без участі адміністратора";

    const nextH = document.createElement("div");
    nextH.className = "next-h";
    nextH.innerHTML = '<div class="eyebrow">Що відбувається далі</div><p></p>';
    nextH.querySelector("p").textContent = "Повідомлення йдуть автоматично — адміністратор не потрібен.";

    const chats = document.createElement("div");
    chats.className = "chats";
    chatsOf(res.messages).forEach((chat, i) => chats.append(renderChat(chat, now, i)));

    const again = document.createElement("button");
    again.type = "button";
    again.className = "again";
    again.textContent = "Пройти ще раз";
    again.onclick = () => location.reload();

    box.append(top, renderTicket(day), nextH, chats, again);
    if (!res.sent) {
      const note = document.createElement("div");
      note.className = "demo-note";
      note.innerHTML = "Це <b>демонстрація</b>. Справжній запис не створюється, повідомлення нікому не йдуть.";
      box.append(note);
    }

    $("flow").hidden = true;
    $("cta-bar").hidden = true;
    $("aside").hidden = true;
    box.hidden = false;
  }

  buildService();
  buildUnits();
  wireHeads();
  loadDays().then(paint);
}
