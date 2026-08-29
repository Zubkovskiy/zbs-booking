// Перевірка полів. Два поля — значить кожне має бути прощаючим.

/**
 * Український мобільний. Приймаємо як завгодно записаний,
 * повертаємо канонічний +380XXXXXXXXX.
 * Людина не має думати про формат — це наша робота.
 * @returns {{ok:true, value:string}|{ok:false, error:string}}
 */
export function normalizePhone(raw) {
  const digits = String(raw ?? "").replace(/\D/g, "");
  if (!digits) return { ok: false, error: "Вкажіть телефон — на нього прийде підтвердження." };

  let nine;
  if (digits.length === 9) nine = digits;                                   // 671112233
  else if (digits.length === 10 && digits.startsWith("0")) nine = digits.slice(1);
  else if (digits.length === 12 && digits.startsWith("380")) nine = digits.slice(3);
  else if (digits.length === 11 && digits.startsWith("80")) nine = digits.slice(2);
  else return { ok: false, error: "У номері має бути 10 цифр. Приклад: 067 111 22 33." };

  if (!/^[3-9]\d{8}$/.test(nine)) return { ok: false, error: "Такого коду оператора не буває." };
  return { ok: true, value: "+380" + nine };
}

/** Показуємо номер по-людськи: +380 67 111 22 33 */
export function prettyPhone(e164) {
  const m = /^\+380(\d{2})(\d{3})(\d{2})(\d{2})$/.exec(e164);
  return m ? `+380 ${m[1]} ${m[2]} ${m[3]} ${m[4]}` : e164;
}

export function normalizeName(raw) {
  const v = String(raw ?? "").trim().replace(/\s+/g, " ");
  if (!v) return { ok: false, error: "Вкажіть ім'я — так ми знаємо, кого чекати." };
  if (v.length < 2) return { ok: false, error: "Ім'я коротке — напишіть повністю." };
  if (v.length > 60) return { ok: false, error: "Занадто довге ім'я." };
  return { ok: true, value: v };
}
