// Рух, який стосується сторінки цілком: прокрутка до кроку і плавна зміна
// висоти блоків. Тут тільки DOM — правило «куди їхати» живе в core/scroll.js.

import { stepScrollTop, scrollDuration, easeInOut } from "../core/scroll.js";

/** Людина просила менше руху — усе нижче має вимкнутись. */
export function calmMotion() {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Прокрутка, яка ЙДЕ ЗА ЦІЛЛЮ.
 *
 * Поміряти позицію в мить кліку не можна: список послуг саме згортається, і
 * місце, у яке ми цілились би зараз, за чверть секунди поїде вгору — через це
 * сторінку й кидало кудись униз. Тому ціль перечитується щокадру: розкладка
 * їде — прокрутка їде разом із нею, і в кінці ми стоїмо саме там, де треба.
 *
 * Будь-який рух від людини (колесо, палець, клавіші) скасовує подорож.
 * Сперечатись із тим, хто вже гортає сам, — найгірше, що може робити сторінка.
 */
export function createScroller() {
  let raf = 0;
  let release = null;

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    if (release) release();
    release = null;
  }

  /** @param {() => number} target рахує бажаний scrollY на цю мить */
  function to(target) {
    stop();
    const start = window.scrollY;
    // Їдемо навіть тоді, коли зараз стояти нікуди: за мить список згорнеться,
    // і крок, який щойно був по центру, поїде на пів екрана вгору. Якщо ціль
    // так і не зрушить, кожен кадр просто поставить сторінку туди, де вона є.
    const ms = scrollDuration(target() - start);
    const t0 = performance.now();

    const bail = () => stop();
    const opts = { passive: true };
    for (const e of ["wheel", "touchstart", "keydown"]) addEventListener(e, bail, opts);
    release = () => {
      for (const e of ["wheel", "touchstart", "keydown"]) removeEventListener(e, bail, opts);
    };

    const frame = (now) => {
      const p = Math.min(1, (now - t0) / ms);
      // Ціль перечитуємо щокадру — саме це й тримає нас на кроці, поки вище
      // згортається список і розгортається підказка.
      window.scrollTo(0, start + (target() - start) * easeInOut(p));
      if (p < 1) raf = requestAnimationFrame(frame);
      else stop();
    };
    raf = requestAnimationFrame(frame);
  }

  return { to, stop };
}

/**
 * Прокрутити до кроку. Позицію рахує core, тут лише міряємо сторінку.
 * @param {{to:(t:()=>number)=>void}} scroller
 * @param {Element} el крок
 * @param {() => number} inset скільки зверху з'їдає липка стрічка
 */
export function glideToStep(scroller, el, inset) {
  scroller.to(() => {
    const r = el.getBoundingClientRect();
    const doc = document.documentElement;
    return stepScrollTop(
      { top: r.top + window.scrollY, height: r.height },
      { height: window.innerHeight, inset: inset(), max: doc.scrollHeight - window.innerHeight },
    );
  });
}

/* Висоти, які ми вже анімуємо. Без цього два кліки поспіль дають два
   накладені переходи, і блок сіпається замість того, щоб доїхати. */
const running = new WeakMap();

/**
 * Замінити вміст блока так, щоб висота не стрибнула, а доїхала.
 * Міряємо до і після, різницю програємо анімацією — усе, що нижче, з'їжджає
 * плавно замість ривка.
 *
 * @param {HTMLElement} box
 * @param {() => void} mutate що саме змінити всередині
 */
export function morphHeight(box, mutate, ms = 500) {
  if (calmMotion() || typeof box.animate !== "function") {
    mutate();
    return;
  }

  // Міряємо поточну — тобто вже анімовану — висоту, а потім знімаємо стару
  // анімацію. Так друга зміна продовжує першу з того місця, де та була.
  const from = box.getBoundingClientRect().height;
  const old = running.get(box);
  if (old) old.cancel();

  mutate();

  const to = box.getBoundingClientRect().height;
  if (Math.abs(to - from) < 1) return;

  box.style.overflow = "hidden";
  const anim = box.animate(
    [{ height: `${from}px` }, { height: `${to}px` }],
    { duration: ms, easing: "cubic-bezier(.37,0,.63,1)" },   // та сама крива, що й --ease
  );
  running.set(box, anim);
  const clear = () => {
    if (running.get(box) === anim) {
      running.delete(box);
      box.style.overflow = "";
    }
  };
  anim.onfinish = clear;
  anim.oncancel = clear;
}
