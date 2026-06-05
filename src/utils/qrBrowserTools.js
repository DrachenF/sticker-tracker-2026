const SCRIPT_LOADERS = new Map()
const QR_DETECT_ERROR = 'No se pudo detectar un QR en esta imagen. Intenta subir una captura más nítida o recortar el QR.'

function loadScriptOnce(url, globalName) {
  if (window[globalName]) {
    return Promise.resolve(window[globalName])
  }

  if (SCRIPT_LOADERS.has(url)) {
    return SCRIPT_LOADERS.get(url)
  }

  const loader = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = url
    script.async = true
    script.onload = () => {
      if (window[globalName]) {
        resolve(window[globalName])
      } else {
        reject(new Error(`No se cargó ${globalName}.`))
      }
    }
    script.onerror = () => reject(new Error(`No se pudo cargar ${url}.`))
    document.head.append(script)
  })

  SCRIPT_LOADERS.set(url, loader)
  return loader
}

async function loadJsQr() {
  if (window.jsQR) {
    return window.jsQR
  }

  const urls = [
    'https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js',
    'https://unpkg.com/jsqr@1.4.0/dist/jsQR.js',
  ]

  let lastError

  for (const url of urls) {
    try {
      return await loadScriptOnce(url, 'jsQR')
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('No se pudo cargar el lector QR.')
}

async function loadQrGenerator() {
  if (window.qrcode) {
    return window.qrcode
  }

  const urls = [
    'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.min.js',
    'https://unpkg.com/qrcode-generator@1.4.4/qrcode.min.js',
  ]

  let lastError

  for (const url of urls) {
    try {
      return await loadScriptOnce(url, 'qrcode')
    } catch (error) {
      lastError = error
    }
  }

  throw lastError || new Error('No se pudo cargar el generador QR.')
}


export function preloadQrTools() {
  return Promise.allSettled([
    loadJsQr(),
    loadQrGenerator(),
  ])
}

function createCanvas(width, height) {
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(width))
  canvas.height = Math.max(1, Math.round(height))
  return canvas
}

function drawSourceToCanvas(source, width, height, scale = 1) {
  const canvas = createCanvas(width * scale, height * scale)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.imageSmoothingEnabled = false
  context.drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

function transformCanvas(sourceCanvas, transform) {
  const canvas = createCanvas(sourceCanvas.width, sourceCanvas.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(sourceCanvas, 0, 0)
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const data = imageData.data

  for (let index = 0; index < data.length; index += 4) {
    const gray = data[index] * 0.299 + data[index + 1] * 0.587 + data[index + 2] * 0.114
    const value = transform(gray)
    data[index] = value
    data[index + 1] = value
    data[index + 2] = value
  }

  context.putImageData(imageData, 0, 0)
  return canvas
}

function cropCenter(sourceCanvas, ratio = 0.78) {
  const cropWidth = sourceCanvas.width * ratio
  const cropHeight = sourceCanvas.height * ratio
  const sourceX = (sourceCanvas.width - cropWidth) / 2
  const sourceY = (sourceCanvas.height - cropHeight) / 2
  const canvas = createCanvas(cropWidth, cropHeight)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  context.drawImage(sourceCanvas, sourceX, sourceY, cropWidth, cropHeight, 0, 0, canvas.width, canvas.height)
  return canvas
}

function buildImageVariants(source, width, height) {
  const base = drawSourceToCanvas(source, width, height)
  const double = drawSourceToCanvas(source, width, height, 2)
  const center = cropCenter(base)
  const variants = [base, double, center, drawSourceToCanvas(center, center.width, center.height, 2)]
  const transformed = []

  variants.forEach((canvas) => {
    transformed.push(canvas)
    transformed.push(transformCanvas(canvas, (gray) => Math.max(0, Math.min(255, (gray - 128) * 1.7 + 128))))
    transformed.push(transformCanvas(canvas, (gray) => (gray > 145 ? 255 : 0)))
    transformed.push(transformCanvas(canvas, (gray) => (gray > 105 ? 255 : 0)))
  })

  return transformed
}

async function decodeWithNativeDetector(canvas) {
  if (!('BarcodeDetector' in window)) {
    return ''
  }

  try {
    const detector = new window.BarcodeDetector({ formats: ['qr_code', 'aztec', 'data_matrix', 'pdf417'] })
    const codes = await detector.detect(canvas)
    return codes.find((code) => code.rawValue)?.rawValue || ''
  } catch {
    return ''
  }
}

async function decodeWithJsQr(canvas) {
  const jsQR = await loadJsQr()
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height)
  const result = jsQR(imageData.data, imageData.width, imageData.height, {
    inversionAttempts: 'attemptBoth',
  })

  return result?.data || ''
}

export async function readQrFromCanvas(canvas) {
  const nativeText = await decodeWithNativeDetector(canvas)

  if (nativeText) {
    return nativeText
  }

  try {
    return await decodeWithJsQr(canvas)
  } catch {
    return ''
  }
}

function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const image = new Image()
    image.onload = () => {
      URL.revokeObjectURL(url)
      resolve(image)
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(QR_DETECT_ERROR))
    }
    image.src = url
  })
}

export async function readQrFromImageFile(file) {
  const image = await loadImageFromFile(file)
  const variants = buildImageVariants(image, image.naturalWidth || image.width, image.naturalHeight || image.height)

  for (const canvas of variants) {
    const text = await readQrFromCanvas(canvas)

    if (text) {
      return text
    }
  }

  throw new Error(QR_DETECT_ERROR)
}

export async function readQrFromVideo(video) {
  if (!video.videoWidth || !video.videoHeight) {
    return ''
  }

  const canvas = drawSourceToCanvas(video, video.videoWidth, video.videoHeight)
  return readQrFromCanvas(canvas)
}

function buildQrSvgDataUrl(qr, quietModules) {
  const moduleCount = qr.getModuleCount()
  const size = moduleCount + quietModules * 2
  const rects = []

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (qr.isDark(row, col)) {
        rects.push(`<rect x="${col + quietModules}" y="${row + quietModules}" width="1" height="1"/>`)
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
}

function drawQrPngCanvas(qr, quietModules, targetSize) {
  const moduleCount = qr.getModuleCount()
  const totalModules = moduleCount + quietModules * 2
  const moduleSize = Math.max(1, Math.floor(targetSize / totalModules))
  const canvasSize = moduleSize * totalModules
  const canvas = createCanvas(canvasSize, canvasSize)
  const context = canvas.getContext('2d', { willReadFrequently: true })

  context.imageSmoothingEnabled = false
  context.fillStyle = '#fff'
  context.fillRect(0, 0, canvasSize, canvasSize)
  context.fillStyle = '#000'

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (qr.isDark(row, col)) {
        context.fillRect(
          (col + quietModules) * moduleSize,
          (row + quietModules) * moduleSize,
          moduleSize,
          moduleSize,
        )
      }
    }
  }

  return canvas
}

export async function generateQrImageAssets(text, options = {}) {
  const qrcode = await loadQrGenerator()
  const qr = qrcode(0, options.errorCorrectionLevel || 'M')
  const quietModules = options.quietModules ?? 8
  const pngSize = options.pngSize ?? 1200

  qr.addData(text)
  qr.make()

  const pngCanvas = drawQrPngCanvas(qr, quietModules, pngSize)

  return {
    svgDataUrl: buildQrSvgDataUrl(qr, quietModules),
    pngDataUrl: pngCanvas.toDataURL('image/png'),
    validationCanvas: pngCanvas,
    moduleCount: qr.getModuleCount(),
  }
}

export async function generateQrDataUrl(text) {
  const assets = await generateQrImageAssets(text)
  return assets.svgDataUrl
}
