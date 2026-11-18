// Test della lettura di prescrizioni e referti (documenti di esempio con dati inventati).
//   node tests/import.test.mjs            (serve pdfjs-dist: npm install)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { detectKind, itemsToLines, matchPrescription, matchReport, parsePrescription, parseRange, parseReport } from "../src/importDocs/parse.js";
import { extractPdfItems } from "../src/importDocs/pdfText.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const pdfjsPath = process.env.PDFJS_PATH || path.join(here, "..", "node_modules", "pdfjs-dist", "legacy", "build", "pdf.mjs");
const pdfjs = await import(pdfjsPath);
const silence = console.warn; console.warn = () => {};   // avvisi sui font standard: irrilevanti per il testo

async function readPdf(file) {
  const pages = await extractPdfItems(pdfjs, new Uint8Array(fs.readFileSync(path.join(here, "fixtures", file))));
  return pages.map((p) => itemsToLines(p.items));
}

// catalogo minimo come quello predefinito
const types = [
  { id: 1, name: "Glicemia", unit: "mg/dL", code: "90.27.1", aliases: "glucosio|glucosio s" },
  { id: 2, name: "Colesterolo totale", unit: "mg/dL", code: "90.14.3", aliases: "colesterolo" },
  { id: 3, name: "Colesterolo HDL", unit: "mg/dL", code: "90.14.1", aliases: "hdl" },
  { id: 4, name: "Trigliceridi", unit: "mg/dL", code: "90.43.2", aliases: "" },
  { id: 5, name: "TSH", unit: "mU/L", code: "90.42.1", aliases: "tireotropina" },
  { id: 6, name: "FT4", unit: "ng/dL", code: "90.42.3", aliases: "tiroxina libera" },
  { id: 7, name: "FT3", unit: "pg/mL", code: "90.43.3", aliases: "triiodotironina libera|triodotironina libera" },
  { id: 8, name: "Emocromo completo", unit: "", code: "90.62.2", aliases: "emocromo|emocromo citom e form" },
  { id: 9, name: "Esame urine completo", unit: "", code: "90.44.3", aliases: "esame delle urine|urine esame completo" },
  { id: 10, name: "Emoglobina", unit: "g/dL", code: "", aliases: "hb" },
  { id: 11, name: "Eosinofili (%)", unit: "%", code: "", aliases: "eosinofili" },
  { id: 12, name: "Cortisolo basale (ore 8)", unit: "µg/dL", code: "", aliases: "cortisolo", active: 0 },
];

// --- prescrizione con 8 prestazioni
let pages = await readPdf("prescrizione-esempio.pdf");
assert.equal(detectKind(pages), "prescrizione");
let p = parsePrescription(pages);
assert.equal(p.date, "2026-11-04");
assert.equal(p.nre, "160A20000012345");
assert.equal(p.doctor, "BIANCHI ANNA");
assert.equal(p.question, "ASTENIA DI NDD");
assert.equal(p.priority.days, 120);
assert.deepEqual(p.taxCodes, ["RSSMTR80A41H501V"]);               // il CF del medico è escluso
assert.equal(p.items.length, 8);
assert.deepEqual(p.items.map((i) => i.code), ["90.43.3", "90.42.3", "90.42.1", "90.62.2", "90.44.3", "90.14.1", "90.14.3", "90.43.2"]);
assert.match(p.items[3].description, /^EMOCROMO: .* IND\. DERIV$/);
assert.equal(p.items[0].access, "PRIMO ACCESSO");
const pm = matchPrescription(p, types);
assert.deepEqual(pm.map((i) => i.type?.id), [7, 6, 5, 8, 9, 3, 2, 4]);
// senza codice nel catalogo si abbina per nome (tra parentesi, prima dei due punti, inizio della descrizione)
const noCodes = types.map((t) => ({ ...t, code: "" }));
assert.deepEqual(matchPrescription(p, noCodes).map((i) => i.type?.id), [7, 6, 5, 8, 9, 3, 2, 4]);

pages = await readPdf("prescrizione-esempio-glucosio.pdf");
p = parsePrescription(pages);
assert.equal(p.items.length, 1);
assert.equal(p.items[0].description, "GLUCOSIO");
assert.equal(matchPrescription(p, noCodes)[0].type.id, 1);

// --- referto di laboratorio su 2 pagine
pages = await readPdf("referto-esempio.pdf");
assert.equal(detectKind(pages), "referto");
const r = parseReport(pages);
assert.equal(r.sampledDate, "2026-11-06");
assert.equal(r.reportDate, "2026-11-09");
assert.deepEqual(r.taxCodes, ["RSSMTR80A41H501V"]);
const row = (name, i = 0) => r.rows.filter((x) => x.name === name)[i];
assert.equal(row("Glicemia").value, "88.9");
assert.equal(row("Glicemia").unit, "mg/dl");
assert.equal(row("Glicemia").range, "74-109");                      // la nota sulla glicemia non entra nell'intervallo
assert.equal(row("Colesterolo").range, "Livello desiderabile: <200; Borderline alto: 200-240; Alto: >240");
assert.equal(row("Colesterolo HDL").group, "Colesterolo Hdl");
assert.equal(row("Rdw-Sd").flag, true);                            // "*" del laboratorio
assert.equal(row("Rdw-Sd").outOfRange, true);
assert.equal(row("Monociti").flag, true);
assert.equal(row("Glicemia").outOfRange, false);
assert.equal(row("Emoglobina").section, "EMATOLOGIA");
assert.equal(row("Emoglobina").group, "Emocromo Citom. E Form.");
assert.equal(row("TSH").section, "IMMUNOMETRIA");
assert.equal(row("Aspetto").value, "LIMPIDO");
assert.equal(row("Cellule").value, "ALCUNE DELLE BASSE VIE URINARIE");   // valore su due righe, pagina 2
assert.equal(row("Colore").group, "Esame Delle Urine");                  // gruppo che continua a pagina 2
assert.equal(r.rows.length, 48);
const rm = matchReport(r, types);
const byType = (id) => rm.filter((x) => x.type?.id === id);
assert.equal(byType(1)[0].name, "Glicemia");
assert.equal(byType(2)[0].name, "Colesterolo");
assert.equal(byType(3)[0].name, "Colesterolo HDL");               // la riga, non il gruppo "Colesterolo Hdl"
assert.equal(byType(5)[0].value, "2.15");
assert.equal(byType(11).length, 1);
assert.equal(byType(11)[0].unit, "%");                              // Eosinofili %: non quelli assoluti
const urine = byType(9)[0];
assert.equal(urine.panel, true);
assert.equal(urine.children, 16);
assert.match(urine.value, /^Aspetto: LIMPIDO; Colore: GIALLO; .*Cellule: ALCUNE DELLE BASSE VIE URINARIE$/);
const emo = byType(8)[0];
assert.equal(emo.panel, true);
assert.equal(emo.outOfRange, true);
assert.equal(byType(12).length, 0);                                  // tipi disattivati: non usati

// --- foto (testo letto dall'OCR di Tesseract sul server: uscita salvata in fixtures)
import { prepareLines } from "../src/importDocs/parse.js";
const ocr = (f) => [prepareLines(JSON.parse(fs.readFileSync(path.join(here, "fixtures", f))).lines)];
let fp = ocr("foto-prescrizione.ocr.json");
assert.equal(detectKind(fp), "prescrizione");
p = parsePrescription(fp);
assert.equal(p.date, "2026-11-04");
assert.equal(p.items.length, 8);
assert.equal(p.items[3].code, null);                               // codice regionale illeggibile nella foto…
assert.deepEqual(matchPrescription(p, types).map((i) => i.type?.id), [7, 6, 5, 8, 9, 3, 2, 4]);   // …abbinato per descrizione
const fr = parseReport(ocr("foto-referto.ocr.json"));
assert.equal(fr.reportDate, "2026-11-09");
assert.deepEqual(fr.taxCodes, ["RSSMTR80A41H501V"]);
assert.equal(fr.rows.find((x) => x.name === "Glicemia").value, "88.9");
assert.equal(fr.rows.find((x) => x.name === "TSH").section, "IMMUNOMETRIA");
assert.equal(fr.rows.find((x) => x.name === "Rdw-Sd").flag, true);
assert.equal(matchReport(fr, types).filter((x) => x.type).length >= 8, true);

// --- codice fiscale: controllo del carattere finale e letture sbagliate dalle foto
import { compareTaxCode, taxCodeValid } from "../src/importDocs/parse.js";
assert.equal(taxCodeValid("RSSMTR80A41H501V"), true);
assert.equal(taxCodeValid("ASSMTR80A41H501V"), false);                       // R letta come A
assert.equal(compareTaxCode(["RSSMTR80A41H501V"], "RSSMTR80A41H501V"), "ok");
assert.equal(compareTaxCode(["ASSMTR80A41H501V"], "RSSMTR80A41H501V"), "simile");
assert.equal(compareTaxCode(["BNCMRA90E04H501T"], "RSSMTR80A41H501V"), "diverso");  // valido e diverso: altra persona
assert.equal(compareTaxCode([], "RSSMTR80A41H501V"), "assente");

// --- intervalli
assert.deepEqual(parseRange("m.f. 82 - 98 fL"), { min: 82, max: 98 });
assert.deepEqual(parseRange("12,5 - 16,5 g/dl"), { min: 12.5, max: 16.5 });
assert.deepEqual(parseRange("< 4.5"), { min: null, max: 4.5 });
assert.deepEqual(parseRange("> 65"), { min: 65, max: null });
assert.equal(parseRange("vedi nota"), null);

console.warn = silence;
console.log("TEST IMPORTAZIONE OK");
