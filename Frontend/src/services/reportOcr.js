// Reads text from an uploaded report. Libraries are loaded only when a file is chosen,
// so they don't slow down the rest of the app. Everything runs in the browser:
// the report is never uploaded to a server.

// Static `?url` import: in Vite dev, a dynamic import('…?url') of this file returned the worker
// module itself instead of its URL, so pdf.js rejected it and every PDF failed to read.
// This module is itself loaded lazily (only when a file is chosen), so nothing loads early.
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

async function ocrImage(image) {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng');
  try {
    const { data } = await worker.recognize(image);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

async function readPdf(file) {
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise;
  const pages = [];
  for (let number = 1; number <= Math.min(pdf.numPages, 5); number += 1) {
    const page = await pdf.getPage(number);
    const content = await page.getTextContent();
    // Rebuild lines from text items using their vertical position.
    const rows = new Map();
    content.items.forEach((item) => {
      const y = Math.round(item.transform[5]);
      rows.set(y, `${rows.get(y) || ''} ${item.str}`);
    });
    let text = [...rows.entries()].sort((a, b) => b[0] - a[0]).map(([, line]) => line.trim()).join('\n');
    if (text.replace(/\s/g, '').length < 20) {
      // Scanned PDF with no text layer: render the page and OCR it.
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      text = await ocrImage(canvas);
    }
    pages.push(text);
  }
  return pages.join('\n');
}

export async function extractReportText(file) {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) return readPdf(file);
  return ocrImage(file);
}
