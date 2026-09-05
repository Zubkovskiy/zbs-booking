// Подія для календаря телефона. Без DOM і без мережі — на виході рядок .ics,
// який однаково розуміють Google Calendar, Apple Calendar і Outlook.

/** У .ics кома, крапка з комою й зворотний слеш мають значення — екрануємо. */
function esc(text) {
  return String(text).replace(/[\;,]/g, (c) => "\\" + c).replace(/\n/g, "\n");
}

const stamp = (d) =>
  [d.getFullYear(), d.getMonth() + 1, d.getDate()].map((n) => String(n).padStart(2, "0")).join("") +
  "T" +
  [d.getHours(), d.getMinutes(), 0].map((n) => String(n).padStart(2, "0")).join("");

/**
 * Подія без часового поясу — «плаваючий» час. Для запису до майстра це саме те,
 * що треба: 9:00 означає 9:00 на місці, хоч би де був телефон.
 *
 * @param {{title:string, at:Date, minutes:number, location?:string, note?:string, uid:string}} e
 * @returns {string} вміст файлу .ics
 */
export function icsEvent(e) {
  const end = new Date(e.at.getTime() + e.minutes * 60000);
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//ZBS//booking//UK",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${e.uid}`,
    `DTSTAMP:${stamp(e.at)}`,
    `DTSTART:${stamp(e.at)}`,
    `DTEND:${stamp(end)}`,
    `SUMMARY:${esc(e.title)}`,
    e.location ? `LOCATION:${esc(e.location)}` : "",
    e.note ? `DESCRIPTION:${esc(e.note)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ].filter(Boolean).join("\r\n");
}

/** Посилання на карти за адресою. Працює і в браузері, і в застосунку. */
export function mapsLink(address) {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}
