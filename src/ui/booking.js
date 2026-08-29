// Рендер сторінки запису. Єдиний файл, який знає про DOM.
// Логіки розкладу тут немає — вона в core/, і тому покрита тестами.

import { nextDays, countFree, bestDayIndex } from "../core/schedule.js";
import { plural, shortDate, dayLabel, MONTH_SHORT } from "../core/format.js";
import { normalizePhone, normalizeName } from "../core/validate.js";

const DAYS_AHEAD = 14;

export function mountBooking(root, business, adapter) {
  const $ = (id) => root.querySelector(`#${id}`);
  const state = { service: null, unit: 0, date: null, time: null, slots: [] };

  // ── шапка ────────────────────────────────────────────────────────────
  $("b-name").textContent = business.name;
  $("b-kind").textContent = business.kind;
  $("b-tag").textContent = business.tagline;
  $("b-addr").textContent = business.address;
  $("b-open").textContent = business.openLine;
  $("sig").textContent = business.signature;
  $("unit-title").textContent = business.unitTitle;

  // ── послуги ──────────────────────────────────────────────────────────
  business.services.forEach((s, i) => {
    $("services").append(
      option({
        name: s.name,
        sub: s.note,
        price: s.price,
        onPick: (btn) => {
          state.service = i;
          press($("services"), btn);
          $("p-service").textContent = s.name;
          refreshSlots();
        },
      }),
    );
  });

  // ── пости / майстри ──────────────────────────────────────────────────
  business.units.forEach((u, i) => {
    const btn = option({
      name: u.name,
      sub: u.note,
      onPick: (b) => {
        state.unit = i;
        press($("units"), b);
        $("p-unit").textContent = u.name;
        rebuildDays();
      },
    });
    if (i === 0) btn.setAttribute("aria-pressed", "true");
    $("units").append(btn);
  });
  $("p-unit").textContent = business.units[0].name;

  // ── дні ──────────────────────────────────────────────────────────────
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  async function rebuildDays() {
    const box = $("days");
    box.textContent = "";
    const days = nextDays(today, DAYS_AHEAD).filter((d) => business.workdays.includes(d.getDay()));
    const freeCounts = [];

    for (const d of days) {
      const slots = await adapter.slots(d, state.unit);
      freeCounts.push(countFree(slots));
    }

    days.forEach((d, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "day";
      b.setAttribute("aria-pressed", "false");
      b.disabled = freeCounts[i] === 0;
      b.innerHTML = `<span class="dw"></span><span class="dn"></span><span class="dm"></span>`;
      b.querySelector(".dw").textContent = dayLabel(d, today);
      b.querySelector(".dn").textContent = String(d.getDate());
      b.querySelector(".dm").textContent = freeCounts[i] === 0 ? "немає" : MONTH_SHORT[d.getMonth()];
      b.setAttribute("aria-label", `${shortDate(d)}, ${freeCounts[i]} ${plural(freeCounts[i], "вільне", "вільні", "вільних")}`);
      b.onclick = () => {
        state.date = d;
        state.time = null;
        press(box, b);
        $("p-day").textContent = shortDate(d);
        refreshSlots();
      };
      box.append(b);
    });

    const pick = box.children[bestDayIndex(freeCounts)];
    if (pick && !pick.disabled) pick.click();
    else refreshSlots();
  }

  // ── слоти ────────────────────────────────────────────────────────────
  async function refreshSlots() {
    const box = $("slots");
    box.textContent = "";
    if (!state.date) return;

    state.slots = await adapter.slots(state.date, state.unit);
    const free = countFree(state.slots);

    for (const s of state.slots) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "slot";
      b.textContent = s.time;
      b.disabled = !s.free;
      b.setAttribute("aria-pressed", "false");
      if (!s.free) b.title = s.why === "past" ? "час уже минув" : "зайнято";
      else
        b.onclick = () => {
          state.time = s.time;
          press(box, b);
          $("p-time").textContent = s.time;
          sync();
        };
      box.append(b);
    }
    $("p-time").textContent = free ? `${free} ${plural(free, "вільне", "вільні", "вільних")}` : "немає вільних";
    sync();
  }

  // ── підсумок і кнопка ────────────────────────────────────────────────
  function sync() {
    const ready = state.service !== null && state.date && state.time;
    $("go").disabled = !ready;
    $("sum").innerHTML = ready
      ? `<b>${esc(business.services[state.service].name)}</b> · ${shortDate(state.date)} о <b>${state.time}</b> · ${esc(business.units[state.unit].name)}`
      : state.service === null
        ? "Оберіть послугу, щоб побачити вільний час."
        : "Оберіть вільний час.";
  }

  // ── відправлення ─────────────────────────────────────────────────────
  $("go").onclick = async () => {
    const name = normalizeName($("nm").value);
    const phone = normalizePhone($("ph").value);
    // Обидві перевірки виконуються завжди: людина має побачити всі помилки
    // за один раз, а не виправляти поля по черзі.
    const nameOk = showError($("nm-err"), name);
    const phoneOk = showError($("ph-err"), phone);
    if (!nameOk || !phoneOk) {
      root.querySelector(nameOk ? "#ph" : "#nm").focus();
      return;
    }

    $("go").disabled = true;
    $("go").textContent = "Записуємо…";
    try {
      const res = await adapter.submit({
        name: name.value,
        phone: phone.value,
        service: business.services[state.service].name,
        unit: business.units[state.unit].name,
        date: state.date,
        time: state.time,
      });
      renderDone(root, business, state, res);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      $("go").disabled = false;
      $("go").textContent = "Записатись";
      $("sum").innerHTML = `<b>Не вдалось записати.</b> Перевірте зв'язок і спробуйте ще раз.`;
    }
  };

  rebuildDays();
}

// ── допоміжне ──────────────────────────────────────────────────────────
function option({ name, sub, price, onPick }) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "opt";
  b.setAttribute("aria-pressed", "false");
  b.innerHTML = `<span class="txt"><span class="nm"></span><span class="sub"></span></span>${price ? `<span class="price"></span>` : ""}`;
  b.querySelector(".nm").textContent = name;
  b.querySelector(".sub").textContent = sub ?? "";
  if (price) b.querySelector(".price").textContent = price;
  b.onclick = () => onPick(b);
  return b;
}

function press(container, btn) {
  for (const el of container.children) el.setAttribute("aria-pressed", "false");
  btn.setAttribute("aria-pressed", "true");
}

function showError(el, result) {
  el.textContent = result.ok ? "" : result.error;
  el.hidden = result.ok;
  return result.ok;
}

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
}

function renderDone(root, business, state, res) {
  const flow = root.querySelector("#flow");
  const wrap = document.createElement("div");
  wrap.className = "done";
  wrap.innerHTML = `
    <div class="tick" aria-hidden="true">✓</div>
    <h2></h2>
    <p></p>
    <div class="msgs"></div>
    <button class="again" type="button">Пройти ще раз</button>`;
  wrap.querySelector("h2").textContent = `Записано на ${shortDate(state.date)}, ${state.time}`;
  wrap.querySelector("p").textContent = res.sent
    ? "Підтвердження вже надіслано."
    : "Ось що відбувається в цю ж секунду — без участі адміністратора.";

  const box = wrap.querySelector(".msgs");
  const titles = { client: "Клієнту в Telegram", admin: "Адміністратору" };
  res.messages.forEach((m, i) => {
    const card = document.createElement("div");
    card.className = "msg";
    card.innerHTML = `<div class="who"><span></span><em></em></div><div class="body"></div>`;
    card.querySelector(".who span").textContent = i === 2 ? "Нагадування клієнту" : titles[m.to];
    card.querySelector(".who em").textContent =
      typeof m.when === "string" ? m.when : `${shortDate(m.when)}, ${String(m.when.getHours()).padStart(2, "0")}:00`;
    card.querySelector(".body").textContent = m.body;
    box.append(card);
  });

  wrap.querySelector(".again").onclick = () => location.reload();
  flow.replaceChildren(wrap);
}
