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

// NUEVO PRE-PROCESADOR OPTIMIZADO (Rápido y de una sola pasada)
function optimizeImageForOCR(bitmap) {
  // Reducimos la imagen si es gigantesca para no matar a Tesseract
  const MAX_DIM = 1200;
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

  // Escala de grises con alto contraste
  const imageData = ctx.getImageData(0, 0, w, h);
  const data = imageData.data;
  
  for (let i = 0; i < data.length; i += 4) {
    // Luminancia
    const gray = (data[i] * 0.299) + (data[i + 1] * 0.587) + (data[i + 2] * 0.114);
    // Umbral estricto para texto negro sobre fondo blanco/gris claro
    const value = gray > 140 ? 255 : 0; 
    
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

// EXTRACCIÓN INTELIGENTE (Ignora textos legales largos)
function extractSmartCodes(text, validStickerData) {
  const { validCodes, validPrefixes } = validStickerData;
  if (!validPrefixes.length) return [];

  const prefixes = validPrefixes.map(escapeRegExp).join('|');
  const extracted = [];
  
  // Dividimos lo que leyó Tesseract línea por línea
  const lines = text.split('\n').map(l => l.trim().toUpperCase());

  for (const line of lines) {
    // REGLA DE ORO: Si la línea tiene más de 12 caracteres, es casi seguro 
    // texto legal (ej. "FIFA WORLD CUP 2026"). Lo ignoramos por completo.
    if (line.length > 12 || line.length < 4) continue;

    // Buscamos el patrón: inicio de palabra -> prefijo -> espacio opcional -> número -> fin
    const regex = new RegExp(`(^|\\b)(${prefixes})\\s*([0-9OQDISBLZG]{1,3})($|\\b)`, 'g');
    let match;

    while ((match = regex.exec(line)) !== null) {
      const prefix = match[2];
      const number = normalizeNumberLike(match[3]);
      
      if (!number) continue;

      const code = normalizeStickerCode(`${prefix}${number}`);

      // Casos específicos a ignorar que sabemos que causan falsos positivos
      if (line.includes('CUP 20')) continue; 
      
      if (!validCodes.size || validCodes.has(code)) {
        extracted.push(code);
      }
    }
  }

  return Array.from(new Set(extracted));
}

// LA FUNCIÓN PRINCIPAL REESCRITA
export async function analyzeStickerCodesFromImage(recognize, bitmap, stickers) {
  const validStickerData = buildValidStickerData(stickers);
  
  // 1. Optimizamos toda la imagen una sola vez
  const optimizedCanvas = optimizeImageForOCR(bitmap);
  const dataUrl = optimizedCanvas.toDataURL('image/jpeg', 0.9);

  try {
    // 2. Corremos Tesseract UNA VEZ. 
    // Usamos PSM 11 ("Find as much text as possible in no particular order")
    // Es el mejor modo para leer múltiples estampas esparcidas en una foto.
    const result = await recognize(dataUrl, 'eng', {
      tessedit_pageseg_mode: '11', 
    });

    const confidence = Number(result?.data?.confidence ?? 0);
    const text = String(result?.data?.text || '');

    // 3. Extraemos inteligentemente evitando falsos positivos
    const extractedCodes = extractSmartCodes(text, validStickerData);

    const zoneReadings = extractedCodes.map((code, index) => ({
      id: `ocr-result-${index}`,
      confidence: confidence, // Confianza general de la lectura
      rawText: code,
      region: { x: 0, y: 0, width: bitmap.width, height: bitmap.height }, // Región global
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
