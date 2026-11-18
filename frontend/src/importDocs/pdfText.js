// Estrazione del testo (con posizioni) dai PDF, con pdf.js. Nel browser il PDF non lascia mai il computer.

/** pdfjs: la libreria pdf.js già caricata; data: Uint8Array. → [{ items:[{x,y,w,str}], scanned }] per pagina */
export async function extractPdfItems(pdfjs, data, { onPage } = {}) {
  const doc = await pdfjs.getDocument({ data, isEvalSupported: false, useSystemFonts: false }).promise;
  const pages = [];
  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const tc = await page.getTextContent();
    const items = tc.items
      .filter((i) => typeof i.str === "string" && i.str.trim())
      .map((i) => ({ x: i.transform[4], y: i.transform[5], w: i.width, str: i.str }));
    pages.push({ items, scanned: items.length < 5, page });
    onPage?.(n, doc.numPages);
  }
  return pages;
}
