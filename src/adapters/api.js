// Бойовий адаптер: слоти з бекенда, повідомлення шле бекенд.
//
// Тут навмисно немає жодної логіки розкладу — вона одна на весь проєкт
// і лежить у core/schedule.js. Бекенд віддає лише зайнятість.

import { buildSlots } from "../core/schedule.js";

/**
 * @param {{business:object, baseUrl:string, timeoutMs?:number}} opts
 */
export function createApiAdapter({ business, baseUrl, timeoutMs = 8000 }) {
  async function call(path, init) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const r = await fetch(baseUrl + path, {
        ...init,
        signal: ctrl.signal,
        headers: { "content-type": "application/json", ...(init?.headers || {}) },
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return await r.json();
    } finally {
      clearTimeout(t);
    }
  }

  return {
    isDemo: false,

    async slots(date, unitIndex) {
      const key = date.toLocaleDateString("sv");           // YYYY-MM-DD, локальна
      const unit = business.units[unitIndex]?.id ?? "any";
      // Бекенд повертає { taken: [хвилини від півночі] }
      const { taken = [] } = await call(`/slots?date=${key}&unit=${encodeURIComponent(unit)}`);
      const set = new Set(taken);
      return buildSlots(date, business.hours, (min) => set.has(min), new Date(), business.leadMin ?? 60);
    },

    async submit(booking) {
      const res = await call("/book", {
        method: "POST",
        body: JSON.stringify({
          name: booking.name,
          phone: booking.phone,
          service: booking.service,
          unit: booking.unit,
          date: booking.date.toLocaleDateString("sv"),
          time: booking.time,
        }),
      });
      // Бекенд відповідає рівно тими текстами, що їх зібрав core/messages.js
      return { ok: true, sent: true, messages: res.messages ?? [] };
    },
  };
}
