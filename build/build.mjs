#!/usr/bin/env node
// Збірка статичної сторінки запису під конкретний заклад.
//
// Нуль залежностей — навмисно. Ми продаємо надійність; збірка, яка ламається
// від чужого оновлення, суперечить самому продукту. Тут лише fs і трохи регулярок.
//
//   node build/build.mjs                 → зібрати всі профілі з clients/
//   node build/build.mjs mega-servis     → зібрати один

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "src");
const OUT = join(ROOT, "dist");

/* ── мінібандлер ES-модулів ──────────────────────────────────────────────
   Файли проєкту використовують тільки іменовані import/export без
   перейменувань. Цього достатньо, щоб зібрати їх у один модуль
   простим топологічним обходом. Складнішого нам не треба. */

const IMPORT_RE = /^\s*import\s*\{([^}]*)\}\s*from\s*["']([^"']+)["'];?\s*$/gm;

/** Кілька входів в один прохід — інакше спільні модулі оголосяться двічі. */
function bundle(...entries) {
  const seen = new Map();
  const order = [];

  function visit(file) {
    if (seen.has(file)) return;
    seen.set(file, true);
    const code = readFileSync(file, "utf8");

    for (const m of code.matchAll(IMPORT_RE)) {
      const names = m[1];
      if (names.includes(" as ")) {
        throw new Error(`${file}: перейменування в import не підтримується (${names.trim()})`);
      }
      visit(resolve(dirname(file), m[2]));
    }
    order.push([file, code]);
  }

  for (const e of entries) visit(e);

  return order
    .map(([file, code]) =>
      "// ── " + file.slice(SRC.length + 1) + " ──\n" +
      code.replace(IMPORT_RE, "").replace(/^export\s+/gm, "").trim(),
    )
    .join("\n\n");
}

/* ── профілі закладів ───────────────────────────────────────────────── */

function loadProfile(slug) {
  const p = JSON.parse(readFileSync(join(ROOT, "clients", slug + ".json"), "utf8"));
  const need = ["name", "kind", "tagline", "address", "hours", "workdays", "services", "units"];
  const missing = need.filter((k) => p[k] === undefined);
  if (missing.length) throw new Error(`${slug}.json: бракує полів — ${missing.join(", ")}`);
  if (!p.services.length) throw new Error(`${slug}.json: порожній список послуг`);
  if (!p.units.length) throw new Error(`${slug}.json: порожній список постів/майстрів`);
  return p;
}

const RIBBON =
  '<div class="ribbon">Це <b>демонстрація</b>. Справжній запис не створюється, повідомлення нікому не йдуть.</div>';

function build(slug) {
  const biz = loadProfile(slug);
  const demo = biz.mode !== "live";

  const entry = `
${bundle(join(SRC, "ui", "booking.js"), join(SRC, "adapters", demo ? "demo.js" : "api.js"))}

const BUSINESS = ${JSON.stringify(biz, null, 2)};
const adapter = ${demo
      ? "createDemoAdapter({ business: BUSINESS })"
      : "createApiAdapter({ business: BUSINESS, baseUrl: BUSINESS.apiBaseUrl })"};
mountBooking(document, BUSINESS, adapter);
`.trim();

  const html = readFileSync(join(SRC, "index.html"), "utf8")
    .replace("{{TITLE}}", biz.pageTitle ?? `Запис · ${biz.name}`)
    .replace("{{DESCRIPTION}}", biz.pageDescription ?? "Онлайн-запис: вільний час видно одразу, підтвердження приходить миттєво.")
    .replace("{{ROBOTS}}", demo ? "noindex, nofollow" : "index, follow")
    .replace("{{CSS}}", readFileSync(join(SRC, "ui", "booking.css"), "utf8"))
    .replace("{{RIBBON}}", demo ? RIBBON : "")
    .replace("{{JS}}", entry);

  const dir = join(OUT, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.html"), html);
  return { slug, bytes: Buffer.byteLength(html), demo };
}

/* ── запуск ─────────────────────────────────────────────────────────── */

const only = process.argv[2];
const slugs = only
  ? [only]
  : readdirSync(join(ROOT, "clients"))
      .filter((f) => f.endsWith(".json") && !f.startsWith("_"))
      .map((f) => f.replace(/\.json$/, ""));

if (!only) rmSync(OUT, { recursive: true, force: true });

let failed = 0;
for (const slug of slugs) {
  try {
    const r = build(slug);
    console.log(`✓ ${r.slug.padEnd(16)} ${(r.bytes / 1024).toFixed(1).padStart(6)} КБ  ${r.demo ? "демо" : "БОЙОВИЙ"}`);
  } catch (e) {
    failed++;
    console.error(`✗ ${slug}: ${e.message}`);
  }
}
if (failed) process.exit(1);
console.log(`\nГотово: dist/<slug>/index.html`);
