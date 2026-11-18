// Lettura dei file scelti dall'utente → pagine di righe di testo con posizione.
//   PDF con testo   → pdf.js, tutto nel browser (il documento non lascia il computer)
//   PDF scansionato → ogni pagina diventa un'immagine e passa dall'OCR come una foto
//   Foto            → OCR (Tesseract) sul PC server, in memoria, senza salvare nulla
import { api } from "../api";
import { itemsToLines, prepareLines } from "./parse";
import { extractPdfItems } from "./pdfText";

let pdfjsPromise = null;
function loadPdfjs() {
  pdfjsPromise ??= import("pdfjs-dist/legacy/build/pdf.mjs").then((pdfjs) => {
    pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";   // copiato in frontend/public
    return pdfjs;
  });
  return pdfjsPromise;
}

const isPdf = (f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name);

function canvasToBase64(canvas, quality = 0.9) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) { reject(new Error("Conversione dell'immagine non riuscita.")); return; }
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]);
      reader.onerror = () => reject(new Error("Lettura dell'immagine non riuscita."));
      reader.readAsDataURL(blob);
    }, "image/jpeg", quality);
  });
}

/** Foto → JPEG in scala di grigi, lato lungo tra 1600 e 3000 px (dimensione buona per l'OCR). */
async function photoToBase64(file) {
  let bmp;
  try {
    bmp = await createImageBitmap(file);
  } catch {
    throw new Error(`Formato non leggibile (${file.name}). Usa JPG o PNG: le foto HEIC dell'iPhone vanno salvate come JPG `
      + "(Impostazioni › Fotocamera › Formati › Più compatibile).");
  }
  const longSide = Math.max(bmp.width, bmp.height);
  const scale = longSide > 3000 ? 3000 / longSide : longSide < 1600 ? 1600 / longSide : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext("2d");
  ctx.filter = "grayscale(1) contrast(1.15)";
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return canvasToBase64(canvas);
}

async function ocr(base64) {
  const res = await api.post("/api/ocr", { image_b64: base64 });
  return prepareLines(res.lines);
}

/**
 * files: File[] (un PDF oppure una o più foto, una per pagina).
 * onStatus(testo) per l'avanzamento. → { pages: [[righe]], source: "pdf" | "foto" | "pdf-scansione" }
 */
export async function readDocument(files, { ocrAvailable, onStatus = () => {} }) {
  if (!files.length) throw new Error("Nessun file scelto.");
  const pdfs = files.filter(isPdf);
  if (pdfs.length && (pdfs.length > 1 || files.length > 1)) throw new Error("Scegli un solo PDF alla volta (oppure una o più foto).");

  if (pdfs.length) {
    onStatus("Lettura del PDF…");
    const pdfjs = await loadPdfjs();
    const data = new Uint8Array(await pdfs[0].arrayBuffer());
    const raw = await extractPdfItems(pdfjs, data, { onPage: (n, tot) => onStatus(`Lettura del PDF: pagina ${n} di ${tot}…`) });
    const pages = [];
    let scanned = false;
    for (const [i, p] of raw.entries()) {
      if (!p.scanned) { pages.push(itemsToLines(p.items)); continue; }
      scanned = true;
      if (!ocrAvailable) throw new Error("Il PDF è una scansione (contiene solo immagini) e la lettura delle immagini non è attiva sul server.");
      onStatus(`Pagina ${i + 1} scansionata: riconoscimento del testo…`);
      const viewport = p.page.getViewport({ scale: 2.5 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      await p.page.render({ canvasContext: canvas.getContext("2d"), viewport }).promise;
      pages.push(await ocr(await canvasToBase64(canvas)));
    }
    return { pages, source: scanned ? "pdf-scansione" : "pdf" };
  }

  if (!ocrAvailable) {
    throw new Error("La lettura delle foto non è attiva: sul PC server manca Tesseract OCR. Carica il PDF, oppure chiedi all'amministratore di installarlo (vedi README).");
  }
  const pages = [];
  for (const [i, f] of files.entries()) {
    onStatus(files.length > 1 ? `Riconoscimento del testo: foto ${i + 1} di ${files.length}…` : "Riconoscimento del testo dalla foto…");
    pages.push(await ocr(await photoToBase64(f)));
  }
  return { pages, source: "foto" };
}
