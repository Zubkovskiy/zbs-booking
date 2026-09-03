// Розклад: робочі дні, слоти, зайнятість.
// Без DOM і без мережі — усе тут чисте й покривається тестами.

/**
 * @typedef {Object} Hours
 * @property {number} from   година початку, 9
 * @property {number} to     година кінця (не включно), 18
 * @property {number} stepMin крок у хвилинах, 60
 */

/**
 * @typedef {Object} Slot
 * @property {string} time  "14:30"
 * @property {number} min   хвилини від півночі
 * @property {boolean} free
 * @property {"past"|"taken"|null} why  чому недоступний
 */

/** Локальна дата у вигляді YYYY-MM-DD. НЕ toISOString — той зсуває на UTC. */
export function dayKey(date) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Той самий вхід завжди дає ту саму картину зайнятості (FNV-1a). */
export function hashPercent(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % 100;
}

/**
 * Номер запису — те, що людина називає, коли дзвонить: «я на 1230».
 * Береться з самого запису, а не з лічильника: демо не має де його тримати,
 * а той самий запис мусить давати той самий номер і сьогодні, і завтра.
 * @param {string} seed усе, що робить запис унікальним
 * @returns {number} чотири цифри, ніколи не з нуля
 */
export function ticketCode(seed) {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return 1000 + ((h >>> 0) % 9000);
}

/** Частини доби для сітки годин. Межі — робочі, а не астрономічні. */
const PARTS = [
  { label: "Ранок", to: 12 },
  { label: "День", to: 16 },
  { label: "Вечір", to: 24 },
];

/**
 * Розкласти години по частинах доби.
 *
 * Дев'ять однакових плиток поспіль людина читає як стіну; «Ранок · День ·
 * Вечір» дає їй за що зачепитись оком. Порожні частини не показуємо — краще
 * три плитки під одним підписом, ніж підпис над порожнечею.
 *
 * @param {{time:string}[]} slots
 * @returns {{label:string, slots:object[]}[]} тільки непорожні групи, за порядком доби
 */
export function groupByPartOfDay(slots) {
  return PARTS.map(({ label, to }) => ({
    label,
    slots: slots.filter((s) => {
      const hour = Number(s.time.slice(0, 2));
      const from = PARTS[PARTS.findIndex((p) => p.label === label) - 1]?.to ?? 0;
      return hour >= from && hour < to;
    }),
  })).filter((g) => g.slots.length > 0);
}

export function isWorkday(date, workdays) {
  return workdays.includes(date.getDay());
}

/** Наступні `count` днів від `from` включно. */
export function nextDays(from, count) {
  const out = [];
  for (let i = 0; i < count; i++) {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    d.setHours(0, 0, 0, 0);
    out.push(d);
  }
  return out;
}

/**
 * Сітка часу на день. `taken` вирішує, чи зайнятий слот — його дає адаптер,
 * тому та сама функція обслуговує і демо, і реальний бекенд.
 * @param {Date} date
 * @param {Hours} hours
 * @param {(minutes:number, index:number) => boolean} taken
 * @param {Date} [now]
 * @param {number} [leadMin] за скільки хвилин закривати запис на сьогодні
 * @returns {Slot[]}
 */
export function buildSlots(date, hours, taken, now = new Date(), leadMin = 60) {
  const { from, to, stepMin } = hours;
  if (stepMin <= 0) throw new Error("stepMin має бути > 0");
  const sameDay = dayKey(date) === dayKey(now);
  const cutoff = now.getHours() * 60 + now.getMinutes() + leadMin;
  const slots = [];

  for (let min = from * 60, i = 0; min < to * 60; min += stepMin, i++) {
    const past = sameDay && min <= cutoff;
    const busy = !past && taken(min, i);
    slots.push({
      time: `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`,
      min,
      free: !past && !busy,
      why: past ? "past" : busy ? "taken" : null,
    });
  }
  return slots;
}

export function countFree(slots) {
  return slots.reduce((n, s) => n + (s.free ? 1 : 0), 0);
}

/** Порядковий номер місяця від нуля — щоб порівнювати місяці одним числом. */
export function monthIndex(year, month) {
  return year * 12 + month;
}

/**
 * Клітинки місяця для календаря: спершу порожні заповнювачі до першого
 * понеділка, далі всі дні місяця. Рівно те, що малює сітка 7 колонок.
 * @param {number} year
 * @param {number} month 0–11
 * @returns {{blank:boolean, date:Date|null, day:number, weekend:boolean}[]}
 */
export function monthGrid(year, month) {
  const lead = (new Date(year, month, 1).getDay() + 6) % 7; // пн = 0
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells = [];

  for (let i = 0; i < lead; i++) cells.push({ blank: true, date: null, day: 0, weekend: false });
  for (let n = 1; n <= daysInMonth; n++) {
    const date = new Date(year, month, n);
    cells.push({ blank: false, date, day: n, weekend: (date.getDay() + 6) % 7 > 4 });
  }
  return cells;
}

/**
 * Який день відкрити першим. Порожнє «сьогодні» — погане перше враження,
 * тому шукаємо перший день, де реально є з чого обрати.
 */
export function bestDayIndex(freeByDay, comfortable = 3) {
  const enough = freeByDay.findIndex((n) => n >= comfortable);
  if (enough !== -1) return enough;
  const any = freeByDay.findIndex((n) => n > 0);
  return any !== -1 ? any : 0;
}
