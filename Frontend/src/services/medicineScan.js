// Checks and reads medicine photos in the browser. The photo stays on the device unless the
// patient turns on enhanced reading.

const ANALYSIS_SIZE = 640;
const OCR_SIZE = 2000;
// Deliberately lenient: foil strips are shiny and low in contrast. These catch only photos that
// can't be read at all; the OCR confidence check handles everything in between.
const LIMITS = { minSide: 240, dark: 40, sharpness: 12, glare: 0.45 };

async function toBitmap(file) {
  if (typeof createImageBitmap === 'function') return createImageBitmap(file);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function draw(bitmap, maxSide, options) {
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  canvas.getContext('2d', options).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas;
}

export function measureImage(pixels, width, height) {
  const grey = new Float32Array(width * height);
  let total = 0;
  let clipped = 0;
  for (let index = 0; index < grey.length; index += 1) {
    const value = 0.299 * pixels[index * 4] + 0.587 * pixels[index * 4 + 1] + 0.114 * pixels[index * 4 + 2];
    grey[index] = value;
    total += value;
    if (value > 250) clipped += 1;
  }
  // Sharpness: how strongly each pixel differs from its neighbours (variance of the Laplacian).
  let sum = 0;
  let squares = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y += 1) {
    for (let x = 1; x < width - 1; x += 1) {
      const at = y * width + x;
      const laplacian = grey[at - 1] + grey[at + 1] + grey[at - width] + grey[at + width] - 4 * grey[at];
      sum += laplacian;
      squares += laplacian * laplacian;
      count += 1;
    }
  }
  const mean = count ? sum / count : 0;
  return {
    brightness: total / grey.length,
    glare: clipped / grey.length,
    sharpness: count ? squares / count - mean * mean : 0,
  };
}

export function qualityIssues({ width, height, brightness, sharpness, glare }) {
  if (Math.min(width, height) < LIMITS.minSide) return ['too_small'];
  if (brightness < LIMITS.dark) return ['too_dark'];
  if (glare > LIMITS.glare) return ['glare'];
  if (sharpness < LIMITS.sharpness) return ['blurry'];
  return [];
}

/** Returns a list of problems. An empty list means the photo is worth reading. */
export async function checkPhoto(file) {
  const bitmap = await toBitmap(file);
  const canvas = draw(bitmap, ANALYSIS_SIZE, { willReadFrequently: true });
  const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
  return qualityIssues({ width: bitmap.width, height: bitmap.height, ...measureImage(data, canvas.width, canvas.height) });
}

// Grey, with contrast stretched between the 2nd and 98th brightness percentiles.
function prepareForOcr(canvas) {
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  const histogram = new Uint32Array(256);
  for (let index = 0; index < data.length; index += 4) {
    const grey = Math.round(0.299 * data[index] + 0.587 * data[index + 1] + 0.114 * data[index + 2]);
    data[index] = grey;
    histogram[grey] += 1;
  }
  const pixels = data.length / 4;
  let low = 0;
  let high = 255;
  for (let seen = 0, value = 0; value < 256; value += 1) { seen += histogram[value]; if (seen > pixels * 0.02) { low = value; break; } }
  for (let seen = 0, value = 255; value >= 0; value -= 1) { seen += histogram[value]; if (seen > pixels * 0.02) { high = value; break; } }
  const range = Math.max(1, high - low);
  for (let index = 0; index < data.length; index += 4) {
    const stretched = Math.max(0, Math.min(255, ((data[index] - low) * 255) / range));
    data[index] = stretched;
    data[index + 1] = stretched;
    data[index + 2] = stretched;
  }
  context.putImageData(image, 0, 0);
  return canvas;
}

let workerPromise = null;

function getWorker() {
  if (!workerPromise) {
    workerPromise = import('tesseract.js').then(({ createWorker }) => createWorker('eng'));
    workerPromise.catch(() => { workerPromise = null; });
  }
  return workerPromise;
}

/** Frees the OCR engine's memory. Call when leaving the scan screen. */
export async function releaseOcr() {
  const pending = workerPromise;
  workerPromise = null;
  if (pending) (await pending).terminate();
}

/** Returns { text, confidence, cutOff }. cutOff means readable words touch the left or right edge. */
export async function readPhoto(file) {
  const canvas = prepareForOcr(draw(await toBitmap(file), OCR_SIZE, { willReadFrequently: true }));
  const worker = await getWorker();
  const { data } = await worker.recognize(canvas, {}, { text: true, blocks: true });
  const margin = canvas.width * 0.012;
  const words = (data.blocks || []).flatMap((block) => (block.paragraphs || []).flatMap((paragraph) => (paragraph.lines || []).flatMap((line) => line.words || [])));
  const cutOff = words.some((word) => word.confidence > 60 && word.text.length > 3 && (word.bbox.x0 <= margin || word.bbox.x1 >= canvas.width - margin));
  return { text: data.text || '', confidence: data.confidence ?? null, cutOff };
}

/** Text from a prescription image or PDF. Reuses the report reader for PDFs. */
export async function readPrescriptionFile(file) {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const { extractReportText } = await import('./reportOcr');
    return { text: await extractReportText(file), confidence: null };
  }
  return readPhoto(file);
}
