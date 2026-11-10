// src/ altındaki her .js dosyasına `node --check` uygular (elle liste tutmak 7/27'de kalmıştı).
import { readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const kok = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const dosyalar = [];
(function gez(d) {
  for (const a of readdirSync(d)) {
    const y = join(d, a);
    if (statSync(y).isDirectory()) gez(y);
    else if (/\.js$/.test(a)) dosyalar.push(y);
  }
})(kok);

let hata = 0;
for (const f of dosyalar) {
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf8" });
  if (r.status !== 0) { hata++; console.error(`SÖZDİZİMİ HATASI: ${f}\n${r.stderr}`); }
}
console.log(`${dosyalar.length} dosya kontrol edildi, ${hata} hata.`);
process.exit(hata ? 1 : 0);
