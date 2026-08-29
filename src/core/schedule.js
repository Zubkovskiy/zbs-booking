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
