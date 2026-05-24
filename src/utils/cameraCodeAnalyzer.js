import { classifyZoneReadings } from './ocrStickerCodes'

function normalizeRaw(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function normalizeStickerCode(value) {
  const raw = normalizeRaw(value)
  const match = raw.match(/^([A-Z]{3})0*(\d{1,3})$/)
  if (!match) return raw
  return `${match[1]}${Number(match[2])}`
}

function normalizeNumberLike(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/[OQD]/g, '0')
    .replace(/[IL]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2')
    .replace(/G/g, '6')
    .replace(/[^0-9]/g, '')
}

function collectStickerCodes(input, output = []) {
  if (!input) return output
  if (typeof input === 'string' || typeof input === 'number') {
    output.push(String(input))
    return output
  }
  if (Array.isArray(input)) {
    input.forEach(item => collectStickerCodes(item, output))
    return output
  }
  if (typeof input === 'object') {
    const directCode = input?.code || input?.codigo || input?.id || input?.label || input?.number || ''
    if (directCode) output.push(String(directCode))
    Object.entries(input).forEach(([key, value]) => {
      output.push(String(key))
      collectStickerCodes(value, output)
    })
  }
  return output
}

function buildValidStickerData(stickers) {
  const stickerCodes = collectStickerCodes(stickers)
  const validCodes = new Set(
    stickerCodes.map(normalizeStickerCode).filter(code => /^[A-Z]{3}\d{1,3}$/.test(code))
  )
  const validPrefixes = Array.from(
    new Set(Array.from(validCodes).map(code => code.match(/^([A-Z]{3})\d+$/)?.[1]).filter(Boolean))
  )
  return { validCodes, validPrefixes }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// NUEVO PRE-PROCESADOR (Sin Binarización Destructiva)
function optimizeImageForOCR(bitmap) {
  // Reducimos la imagen si es gigantesca (Tesseract lee mejor en 1000px max)
  const MAX_DIM = 1000;
  let scale = 1;
  if (bitmap.width > MAX_DIM || bitmap.height > MAX_DIM) {
    scale = MAX_DIM / Math.max(bitmap.width, bitmap.height);
  }

  const w = Math.floor(bitmap.width * scale);
  const h = Math.floor(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);

  // Pasamos a Escala de Grises y aumentamos levmente el contraste.
  // IMPORTANTE: Ya NO usamos un corte brusco (blanco o negro absoluto)
  // para evitar borrar el texto si la foto tiene mala luz.
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
    
    // Aumentar levemente el contraste (+20%)
    let contrast = ((gray - 128) * 1.2) + 128;
    contrast = Math.max(0, Math.min(255, contrast));
    
    data[i] = contrast;
    data[i + 1] = contrast;
    data[i + 2] = contrast;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

function sanitizeText(text) {
  // Remover palabras legales de Panini que generan códigos falsos 
  // (Esto evita nativamente errores como CUP20, PAR5, SEN5)
  const stopWords = [
    'FIFA', 'WORLD', 'CUP', '2026', 'PARTE', 'INTEGRANTE', 'CROMO', 
    'LIVRO', 'ILUSTRADO', 'COLECIONAR', 'PUNTOS', 'VENTA', 'OFFICIAL', 
    'LICENSED', 'PRODUCT', 'LOGOS', 'BRAND', 'ELEMENTS', 'DESIGNS', 
    'TRADE', 'NAMES', 'TOURNAMENTS', 'EVENTS', 'COPYRIGHTS', 'TRADEMARKS', 
    'MANUFACTURED', 'UNDER', 'LICENCE', 'MADE', 'BRAZIL', 'PANINI', 'BRASIL', 'LTDA'
  ];
  
  let clean = String(text || '').toUpperCase();
  
  stopWords.forEach(word => {
    const regex = new RegExp(`\\b${word}\\b`, 'g');
    clean = clean.replace(regex, ' ');
  });
  
  return clean;
}

function extractSmartCodes(text, validStickerData) {
  const { validCodes, validPrefixes } = validStickerData;
  if (!validPrefixes.length) return [];

  const cleanText = sanitizeText(text);

  const prefixes = validPrefixes.map(escapeRegExp).join('|');
  const extracted = [];
  
  const regex = new RegExp(`(^|\\b)(${prefixes})\\s*([0-9OQDISBLZG]{1,3})($|\\b)`, 'g');
  let match;

  while ((match = regex.exec(cleanText)) !== null) {
    const prefix = match[2];
    const number = normalizeNumberLike(match[3]);
    if (!number) continue;

    const code = normalizeStickerCode(`${prefix}${number}`);
    
    if (!validCodes.size || validCodes.has(code)) {
      extracted.push(code);
    }
  }

  return Array.from(new Set(extracted));
}

export async function analyzeStickerCodesFromImage(recognize, bitmap, stickers) {
  const validStickerData = buildValidStickerData(stickers);
  const optimizedCanvas = optimizeImageForOCR(bitmap);
  const dataUrl = optimizedCanvas.toDataURL('image/jpeg', 0.9);

  try {
    // PSM 11 es la mejor opción para encontrar palabras "sueltas" en cualquier parte de la imagen
    const result = await recognize(dataUrl, 'eng', {
      tessedit_pageseg_mode: '11', 
    });

    const confidence = Number(result?.data?.confidence ?? 0);
    const text = String(result?.data?.text || '');
    
    // ESTO SE IMPRIMIRÁ EN TU CONSOLA. Así podrás ver qué leyó exactamente Tesseract.
    console.log('--- LECTURA RAW OCR ---', text.replace(/\n+/g, ' '));

    const extractedCodes = extractSmartCodes(text, validStickerData);

    const zoneReadings = extractedCodes.map((code, index) => ({
      id: `ocr-result-${index}`,
      confidence: confidence,
      rawText: code,
      // Simulamos regiones distintas para que el motor visual/clasificador no las borre por solapamiento
      region: { x: index * 10, y: index * 10, width: 100, height: 100 },
      thumbUrl: dataUrl,
      manualCode: '',
    }));

    return {
      grouped: classifyZoneReadings(zoneReadings, stickers),
      regions: [] 
    };

  } catch (error) {
    console.error('OCR falló:', error);
    return {
      grouped: classifyZoneReadings([], stickers),
      regions: []
    };
  }
}
