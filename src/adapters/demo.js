// Демо-адаптер: усе локально, жодної мережі, нічого нікуди не йде.
//
// Він навмисно реалізує ТОЙ САМИЙ інтерфейс, що й api.js. Через це демо
// не є одноразовою декорацією: коли клієнт платить, ми міняємо один рядок
// у конфігу, і та сама сторінка починає працювати по-справжньому.

import { buildSlots, hashPercent, dayKey } from "../core/schedule.js";
import { buildAll } from "../core/messages.js";

/** @param {{business:object, busyRatio?:number}} opts */
export function createDemoAdapter({ business, busyRatio = 42 }) {
  return {
    isDemo: true,

    /** @returns {Promise<import("../core/schedule.js").Slot[]>} */
    async slots(date, unitIndex) {
      const seed = `${dayKey(date)}|${unitIndex}`;
      return buildSlots(
        date,
        business.hours,
        (_min, i) => hashPercent(`${seed}|${i}`) < busyRatio,
        new Date(),
        business.leadMin ?? 60,
      );
    },

    /** Нічого не надсилає — тільки показує, що надіслалося б. */
    async submit(booking) {
      return { ok: true, sent: false, messages: buildAll(business, booking) };
    },
  };
}
