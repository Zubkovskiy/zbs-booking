// Складання сторінки. Тут тільки DOM і стан екрана.
// Усе, що можна порахувати без браузера, живе в core/ і покрите тестами.
//
// Блоки послуг і постів будуються ОДИН раз, далі лише синхронізуються.
// Через це випадайка може плавно анімуватись, а фокус із клавіатури
// не губиться на кожному кліку.

import { nextDays, countFree, bestDayIndex, dayKey, monthGrid, monthIndex, isWorkday } from "../core/schedule.js";
import { shortDate, relDayLabel, monthTitle, freeLabel, freeDaysLabel, busyReason, plural, MONTH_FULL, WEEKDAY_HEAD } from "../core/format.js";
import { normalizeName, normalizePhone } from "../core/validate.js";

/** На скільки днів уперед відкритий запис. Три місяці — щоб при щільному
    записі було куди гортати, а не впертись у край вікна. */
const DAYS_AHEAD = 90;

const TICK = '<svg class="tick-sm" width="15" height="15" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M2.5 8.5l3.5 3.5 7.5-8" stroke="var(--free)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEV = '<svg class="chev" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 6l5 5 5-5" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
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
    unit: 0,
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
      const slots = closed ? [] : await adapter.slots(date, state.unit);
      const day = { i, date, key: dayKey(date), closed, slots, free: countFree(slots) };
      days.push(day);
      byKey.set(day.key, day);
    }

    const pick = days[bestDayIndex(days.map((d) => d.free))];
    state.key = pick.key;
    state.time = null;
    state.view = { y: pick.date.getFullYear(), m: pick.date.getMonth() };
  }

  const current = () => byKey.get(state.key) ?? days[0];

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
      : `${business.services.length} ${plural(business.services.length, "послуга", "послуги", "послуг")} · ціни одразу`;
    trigger.querySelector(".price").textContent = chosen ? (chosen.price ?? "") : "";

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
        if (state.unit === i) return;
        state.unit = i;
        await loadDays();       // у іншого поста свій розклад
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

  function paintQuick() {
    const box = $("quick");
    box.textContent = "";
    const chips = [];

    for (const [i, label] of [[0, "сьогодні"], [1, "завтра"]]) {
      const day = days[i];
      if (!day) continue;
      chips.push({
        label,
        sub: day.free ? freeLabel(day.free) : busyReason(day.closed),
        day,
        active: state.key === day.key,
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
        active: monthOf(current()) === month,
      });
    }

    box.hidden = chips.length === 0;

    for (const c of chips) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = `chip${c.active ? " on" : ""}`;
      b.dataset.k = `chip-${c.label}`;
      b.disabled = c.day.free === 0;
      b.innerHTML = '<b class="chip-day"></b><span class="chip-free"></span>';
      b.querySelector(".chip-day").textContent = c.label;
      b.querySelector(".chip-free").textContent = c.sub;
      b.setAttribute("aria-label", `${c.label}, ${shortDate(c.day.date)} — ${c.sub}`);
      if (!b.disabled) b.onclick = () => pickDay(c.day);
      box.append(b);
    }
  }

  function paintCalendar() {
    const { y, m } = state.view;
    const first = days[0];
    const last = days[days.length - 1];
    const shown = monthIndex(y, m);

    $("month").textContent = monthTitle(y, m);
    $("prev").disabled = shown <= monthIndex(first.date.getFullYear(), first.date.getMonth());
    $("next").disabled = shown >= monthIndex(last.date.getFullYear(), last.date.getMonth());
    $("prev").onclick = () => shiftMonth(-1);
    $("next").onclick = () => shiftMonth(1);

    const head = $("wd");
    head.textContent = "";
    WEEKDAY_HEAD.forEach((t, i) => {
      const s = document.createElement("span");
      if (i > 4) s.className = "we";
      s.textContent = t;
      head.append(s);
    });

    const grid = $("days");
    grid.textContent = "";

    for (const cell of monthGrid(y, m)) {
      const b = document.createElement("button");
      b.type = "button";
      b.innerHTML = '<span class="n"></span><span class="dot"></span>';

      if (cell.blank) {
        b.className = "cell blank";
        b.disabled = true;
        grid.append(b);
        continue;
      }

      const day = byKey.get(dayKey(cell.date));
      const kind = !day ? "out" : day.free > 0 ? "free" : "none";
      const sel = !!day && day.key === state.key;

      b.className = `cell ${kind}${sel ? " sel" : ""}`;
      b.querySelector(".n").textContent = String(cell.day);
      b.disabled = kind !== "free";
      b.setAttribute("aria-pressed", String(sel));
      b.title = !day
        ? `запис відкритий на ${DAYS_AHEAD} ${plural(DAYS_AHEAD, "день", "дні", "днів")} уперед`
        : day.free === 0
          ? busyReason(day.closed)
          : freeLabel(day.free);
      b.setAttribute("aria-label", `${shortDate(cell.date)} — ${b.title}`);
      if (kind === "free") {
        b.dataset.k = `cell-${day.key}`;
        b.onclick = () => pickDay(day);
      }

      grid.append(b);
    }
  }

  function shiftMonth(dir) {
    const d = new Date(state.view.y, state.view.m + dir, 1);
    state.view = { y: d.getFullYear(), m: d.getMonth() };
    paint();
  }

  /* ── крок 4: час ─────────────────────────────────────────────────────── */
  function paintSlots() {
    const day = current();
    const box = $("slots");
    box.textContent = "";

    const counter = $("p-time");
    counter.className = `count${day.free ? "" : " zero"}`;
    counter.textContent = `${day.free ? freeLabel(day.free) : busyReason(day.closed)} · ${relDayLabel(day.date, today)}`;

    for (const s of day.slots) {
      const sel = state.time === s.time && s.free;
      const b = document.createElement("button");
      b.type = "button";
      b.className = `slot ${s.free ? "free" : s.why === "past" ? "past" : "busy"}${sel ? " sel" : ""}`;
      b.textContent = s.time;
      b.disabled = !s.free;
      b.setAttribute("aria-pressed", String(sel));
      b.title = s.free ? "вільно" : s.why === "past" ? "час уже минув" : "зайнято";
      if (s.free) {
        b.dataset.k = `slot-${s.time}`;
        b.onclick = () => {
          state.time = s.time;
          paint();
        };
      }
      box.append(b);
    }
  }

  /* ── підсумок і кнопка ───────────────────────────────────────────────── */
  function paintFoot() {
    const day = current();
    const svc = state.svc === null ? null : business.services[state.svc];
    const unit = business.units[state.unit];
    const ready = !!svc && !!state.time;

    $("p-service").textContent = svc ? svc.name : "оберіть";
    $("p-service").className = `pick${svc ? " on" : ""}`;
    $("p-unit").textContent = unit.name;
    $("p-day").textContent = relDayLabel(day.date, today);

    const typed = $("nm").value.trim();
    $("p-name").textContent = typed || "заповніть";
    $("p-name").className = `pick${typed ? " on" : ""}`;

    $("sum").textContent = !svc
      ? "Оберіть послугу, щоб побачити вільний час."
      : !state.time
        ? "Оберіть час — і можна записуватись."
        : `${svc.name} · ${shortDate(day.date)} о ${state.time} · ${unit.name}`;

    $("go").disabled = !ready || state.sending;
    $("go").textContent = state.sending ? "Записуємо…" : "Записатись";
  }

  function paint() {
    // Сітки перемальовуються, тому фокус із клавіатури треба повернути на
    // ту саму кнопку, інакше він падає на початок сторінки.
    const held = root.activeElement && root.activeElement.dataset ? root.activeElement.dataset.k : null;

    syncService();
    syncUnits();
    paintQuick();
    paintCalendar();
    paintSlots();
    paintFoot();

    if (held) {
      const back = root.querySelector(`[data-k="${held}"]`);
      if (back) back.focus();
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
  };
  $("ph").oninput = () => clearError($("ph"), $("ph-err"));

  /* ── відправлення ────────────────────────────────────────────────────── */
  $("go").onclick = async () => {
    const name = normalizeName($("nm").value);
    const phone = normalizePhone($("ph").value);
    // Обидві перевірки виконуються завжди: людина має побачити всі помилки
    // за один раз, а не виправляти поля по черзі.
    const nameOk = showError($("nm"), $("nm-err"), name);
    const phoneOk = showError($("ph"), $("ph-err"), phone);
    if (!nameOk || !phoneOk) {
      $(nameOk ? "ph" : "nm").focus();
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
      renderDone(day, res);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      state.sending = false;
      paintFoot();
      $("sum").textContent = "Не вдалось записати. Перевірте зв'язок і спробуйте ще раз.";
    }
  };

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

    box.append(tick, h, lead, msgs, again);
    $("flow").hidden = true;
    box.hidden = false;
  }

  buildService();
  buildUnits();
  loadDays().then(paint);
}
