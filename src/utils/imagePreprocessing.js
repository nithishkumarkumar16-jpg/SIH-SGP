/**
 * imagePreprocessing.js — SGP Adaptive Image Preprocessing for Browser OCR
 * 
 * Provides memory-safe, lightweight canvas preprocessing variants:
 * - Variant A: Grayscale + normalized contrast enhancement (standard)
 * - Variant B: Grayscale + contrast + adaptive/high-contrast thresholding (for faint prints/stamps)
 * - Variant C: Grayscale + 3x3 unsharp mask sharpening (for blurred scans)
 * 
 * 100% browser-based, memory-capped, no external APIs.
 */

const OCR_MAX_EDGE = 3200;
const OCR_MAX_PIXELS = 10_000_000;

/**
 * Calculates optimal width and height within safe canvas memory limits.
 */
export function fitOCRCanvas(width, height) {
  const maxEdge = Math.max(width, height);
  let scale = 1;

  if (maxEdge < 2200) {
    // Upscale phone camera photos/scans to ~2400px on the long edge for crisp character edges in Tesseract (300 DPI equivalent)
    scale = Math.min(2.5, 2400 / maxEdge);
  } else if (maxEdge > OCR_MAX_EDGE) {
    scale = OCR_MAX_EDGE / maxEdge;
  }

  if (width * height * scale * scale > OCR_MAX_PIXELS) {
    scale = Math.sqrt(OCR_MAX_PIXELS / (width * height));
  }

  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    scale,
  };
}

/**
 * Applies a 3x3 convolution filter to a single-channel grayscale buffer.
 */
function applyConvolution3x3(input, output, width, height, kernel) {
  for (let y = 1; y < height - 1; y++) {
    const rowOffset = y * width;
    const topOffset = (y - 1) * width;
    const botOffset = (y + 1) * width;

    for (let x = 1; x < width - 1; x++) {
      let sum = 0;
      sum += input[topOffset + x - 1] * kernel[0];
      sum += input[topOffset + x]     * kernel[1];
      sum += input[topOffset + x + 1] * kernel[2];
      sum += input[rowOffset + x - 1] * kernel[3];
      sum += input[rowOffset + x]     * kernel[4];
      sum += input[rowOffset + x + 1] * kernel[5];
      sum += input[botOffset + x - 1] * kernel[6];
      sum += input[botOffset + x]     * kernel[7];
      sum += input[botOffset + x + 1] * kernel[8];

      output[rowOffset + x] = Math.max(0, Math.min(255, Math.round(sum)));
    }
  }
}

/**
 * Calculates optimal Otsu threshold for binarization to strip security watermarks and guilloche patterns.
 */
export function computeOtsuThreshold(grayscale, totalPixels) {
  const hist = new Int32Array(256);
  for (let i = 0; i < totalPixels; i++) {
    hist[grayscale[i]]++;
  }

  let sum = 0;
  for (let t = 0; t < 256; t++) sum += t * hist[t];

  let sumB = 0;
  let wB = 0;
  let wF = 0;
  let varMax = 0;
  let threshold = 128;

  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (wB === 0) continue;
    wF = totalPixels - wB;
    if (wF === 0) break;

    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;

    const betweenVar = wB * wF * (mB - mF) * (mB - mF);
    if (betweenVar > varMax) {
      varMax = betweenVar;
      threshold = t;
    }
  }

  // Bound threshold within safe document range
  return Math.max(60, Math.min(200, threshold));
}

/**
 * Preprocesses an image or canvas for Tesseract.js OCR with selectable variant:
 * - "contrast" (Variant A/B: Grayscale + normalized contrast stretch)
 * - "sharpened" (Variant C: Grayscale + unsharp mask filter)
 * - "binarized" (Variant D: Grayscale + Otsu thresholding for background pattern removal)
 * 
 * @param {HTMLCanvasElement|ImageBitmap} source
 * @param {Object} [qualityAssessment] Output from analyzeImageQuality
 * @param {string} [variant="contrast"] Preprocessing variant
 * @returns {HTMLCanvasElement} Preprocessed canvas ready for OCR
 */
export function preprocessCanvasForOCR(source, qualityAssessment = null, variant = "contrast") {
  const srcWidth = source.width;
  const srcHeight = source.height;
  const size = fitOCRCanvas(srcWidth, srcHeight);

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;

  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(source, 0, 0, size.width, size.height);

  const imgData = ctx.getImageData(0, 0, size.width, size.height);
  const data = imgData.data;
  const totalPixels = size.width * size.height;

  // If variant is "original", return clean scaled canvas without grayscale/contrast modifications
  if (variant === "original") {
    return canvas;
  }

  // Quality metrics assessment
  const isBlurry = qualityAssessment && qualityAssessment.sharpnessScore < 60;
  const isDark = qualityAssessment && qualityAssessment.brightnessScore < 60;
  const isWashedOut = qualityAssessment && qualityAssessment.avgBrightness > 220;
  const isLowContrast = qualityAssessment && qualityAssessment.contrastScore < 50;

  // 1. Grayscale conversion + contrast stretch
  const grayscale = new Uint8Array(totalPixels);
  let contrastFactor = 1.20;
  let brightnessShift = 0;

  if (isDark) {
    contrastFactor = 1.30;
    brightnessShift = 20;
  } else if (isWashedOut) {
    contrastFactor = 1.40;
    brightnessShift = -15;
  } else if (isLowContrast) {
    contrastFactor = 1.35;
  }

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const lum = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    const adjusted = Math.max(0, Math.min(255, (lum - 128) * contrastFactor + 128 + brightnessShift));
    grayscale[i] = Math.round(adjusted);
  }

  let finalGray = grayscale;

  // Variant handling
  if (variant === "normalized" || variant === "norm") {
    // PASS E: Adaptive background illumination normalization
    // Eliminates uneven lighting, shadows, and horizontal/vertical gradients
    const gridStep = 40;
    const gridW = Math.max(2, Math.ceil(size.width / gridStep));
    const gridH = Math.max(2, Math.ceil(size.height / gridStep));
    const bgGrid = new Float32Array(gridW * gridH);

    for (let gy = 0; gy < gridH; gy++) {
      for (let gx = 0; gx < gridW; gx++) {
        const startX = gx * gridStep;
        const endX = Math.min(size.width, startX + gridStep);
        const startY = gy * gridStep;
        const endY = Math.min(size.height, startY + gridStep);
        let sum = 0, count = 0;
        for (let y = startY; y < endY; y += 4) {
          const rowOff = y * size.width;
          for (let x = startX; x < endX; x += 4) {
            sum += grayscale[rowOff + x];
            count++;
          }
        }
        bgGrid[gy * gridW + gx] = count > 0 ? (sum / count) : 128;
      }
    }

    const normalized = new Uint8Array(totalPixels);
    for (let y = 0; y < size.height; y++) {
      const gy = Math.min(gridH - 1, Math.floor(y / gridStep));
      const rowOff = y * size.width;
      for (let x = 0; x < size.width; x++) {
        const gx = Math.min(gridW - 1, Math.floor(x / gridStep));
        const bgVal = Math.max(15, bgGrid[gy * gridW + gx]);
        const val = Math.min(255, Math.max(0, Math.round((grayscale[rowOff + x] / bgVal) * 200)));
        normalized[rowOff + x] = val;
      }
    }
    finalGray = normalized;
  } else if (variant === "binarized") {
    // PASS D: High-contrast binarization via Otsu's thresholding
    const otsuThresh = computeOtsuThreshold(grayscale, totalPixels);
    const binarized = new Uint8Array(totalPixels);
    for (let i = 0; i < totalPixels; i++) {
      binarized[i] = grayscale[i] < otsuThresh ? 0 : 255;
    }
    finalGray = binarized;
  } else if (variant === "sharpened" || isBlurry) {
    // PASS C: 3x3 unsharp mask sharpening
    if (size.width >= 100 && size.height >= 100) {
      const sharpened = new Uint8Array(totalPixels);
      sharpened.set(grayscale);
      const sharpenKernel = [
         0, -0.6,  0,
        -0.6, 3.4, -0.6,
         0, -0.6,  0
      ];
      applyConvolution3x3(grayscale, sharpened, size.width, size.height, sharpenKernel);
      finalGray = sharpened;
    }
  }

  // Write back to ImageData as monochrome RGB
  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const val = finalGray[i];
    data[idx] = val;
    data[idx + 1] = val;
    data[idx + 2] = val;
    data[idx + 3] = 255;
  }

  ctx.putImageData(imgData, 0, 0);
  return canvas;
}

/**
 * Applies single-pass adaptive enhancement to recover low-quality (FAIR or POOR) scans.
 * Uses adaptive contrast stretching and subtle sharpening.
 * 
 * @param {HTMLCanvasElement|ImageBitmap} source
 * @param {Object} [qualityAssessment]
 * @returns {HTMLCanvasElement}
 */
export function enhanceLowQualityCanvas(source, qualityAssessment = null) {
  const isBlurry = qualityAssessment && qualityAssessment.sharpnessScore < 60;
  const isDark = qualityAssessment && qualityAssessment.brightnessScore < 60;
  const isLowContrast = qualityAssessment && qualityAssessment.contrastScore < 50;

  if (isBlurry) {
    return preprocessCanvasForOCR(source, qualityAssessment, "sharpened");
  } else if (isDark || isLowContrast) {
    return preprocessCanvasForOCR(source, qualityAssessment, "contrast");
  }
  // Default to contrast enhancement for recovery
  return preprocessCanvasForOCR(source, qualityAssessment, "contrast");
}

/**
 * Generates multi-pass canvas variants for high-accuracy marksheet OCR:
 * 1. original: Original high-resolution render (clean, unprocessed)
 * 2. contrast / standard: Grayscale + normalized contrast
 * 3. sharpened: Unsharp mask sharpened
 * 4. binarized: Clean Otsu thresholded black-and-white
 * 5. normalized: Illumination-normalized
 */
export function getPreprocessingVariants(source, qualityAssessment = null) {
  return {
    original: preprocessCanvasForOCR(source, qualityAssessment, "original"),
    standard: preprocessCanvasForOCR(source, qualityAssessment, "contrast"),
    contrast: preprocessCanvasForOCR(source, qualityAssessment, "contrast"),
    sharpened: preprocessCanvasForOCR(source, qualityAssessment, "sharpened"),
    binarized: preprocessCanvasForOCR(source, qualityAssessment, "binarized"),
    normalized: preprocessCanvasForOCR(source, qualityAssessment, "normalized"),
  };
}

/**
 * Selects the most beneficial single-pass preprocessing profile for a given scan quality.
 * Avoids aggressive thresholding on clean documents while aiding degraded ones.
 */
export function selectPreprocessingProfile(qualityAssessment) {
  if (!qualityAssessment) return "contrast";
  if (qualityAssessment.sharpnessScore < 60) return "sharpened";
  if (qualityAssessment.avgBrightness < 60 || qualityAssessment.contrastScore < 50) return "contrast";
  if (qualityAssessment.avgBrightness > 220) return "binarized";
  return "contrast";
}

/**
 * Rotates a canvas by 90, 180, or 270 degrees.
 * 
 * @param {HTMLCanvasElement} canvas
 * @param {number} degrees 0, 90, 180, or 270
 * @returns {HTMLCanvasElement}
 */
export function rotateCanvas(canvas, degrees) {
  const normDeg = ((degrees % 360) + 360) % 360;
  if (normDeg === 0 || !canvas) return canvas;

  const target = document.createElement("canvas");

  if (normDeg === 90 || normDeg === 270) {
    target.width = canvas.height;
    target.height = canvas.width;
  } else {
    target.width = canvas.width;
    target.height = canvas.height;
  }

  try {
    const ctx = target.getContext("2d");
    if (ctx) {
      ctx.translate(target.width / 2, target.height / 2);
      ctx.rotate((normDeg * Math.PI) / 180);
      ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    }
  } catch (e) {
    // jsdom fallback
  }

  return target;
}

/**
 * Corrects small skew angles (-10° to +10°) without clipping document borders.
 * 
 * @param {HTMLCanvasElement} canvas
 * @param {number} angleDegrees Skew angle in degrees
 * @returns {HTMLCanvasElement}
 */
export function deskewCanvas(canvas, angleDegrees) {
  if (!canvas || !angleDegrees || Math.abs(angleDegrees) < 0.2) return canvas;

  const clampedAngle = Math.max(-10, Math.min(10, angleDegrees));
  const rad = (clampedAngle * Math.PI) / 180;

  const target = document.createElement("canvas");
  target.width = canvas.width;
  target.height = canvas.height;

  try {
    const ctx = target.getContext("2d");
    if (ctx) {
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, target.width, target.height);
      ctx.translate(target.width / 2, target.height / 2);
      ctx.rotate(rad);
      ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    }
  } catch (e) {
    // jsdom fallback
  }

  return target;
}

/**
 * Rotates canvas by 90 degrees clockwise or counter-clockwise.
 * 
 * @param {HTMLCanvasElement} canvas
 * @param {boolean} clockwise
 * @returns {HTMLCanvasElement}
 */
export function rotateCanvas90(canvas, clockwise = true) {
  if (!canvas) return canvas;
  const target = document.createElement("canvas");
  target.width = canvas.height;
  target.height = canvas.width;
  try {
    const ctx = target.getContext("2d");
    if (ctx) {
      ctx.translate(target.width / 2, target.height / 2);
      ctx.rotate((clockwise ? 90 : -90) * Math.PI / 180);
      ctx.drawImage(canvas, -canvas.width / 2, -canvas.height / 2);
    }
  } catch (e) {
    // jsdom fallback
  }
  return target;
}

/**
 * Rotates an image file by 90 degrees in browser memory.
 * Preserves original filename and MIME type.
 * 
 * @param {File} file
 * @param {boolean} clockwise
 * @returns {Promise<File>}
 */
export async function rotateImageFile(file, clockwise = true) {
  if (!file || file.type === "application/pdf") return file;
  try {
    let img;
    if (typeof createImageBitmap === "function") {
      img = await createImageBitmap(file);
    } else {
      img = await new Promise((resolve, reject) => {
        const i = new Image();
        const url = URL.createObjectURL(file);
        i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
        i.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image decode failed")); };
        i.src = url;
      });
    }
    const canvas = document.createElement("canvas");
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.drawImage(img, 0, 0);
    img.close?.();

    const rotated = rotateCanvas90(canvas, clockwise);
    const blob = await new Promise((resolve) => {
      if (typeof rotated.toBlob === "function") {
        rotated.toBlob(resolve, file.type || "image/jpeg", 0.95);
      } else {
        resolve(null);
      }
    });
    cleanupCanvas(canvas);
    cleanupCanvas(rotated);
    if (!blob) return file;
    return new File([blob], file.name, { type: file.type || "image/jpeg", lastModified: Date.now() });
  } catch (err) {
    console.warn("Image rotation warning:", err);
    return file;
  }
}

/**
 * Frees canvas memory by clearing dimensions and buffer.
 * 
 * @param {HTMLCanvasElement} canvas
 */
export function cleanupCanvas(canvas) {
  if (!canvas) return;
  try {
    canvas.width = 0;
    canvas.height = 0;
  } catch (e) {
    // Memory cleanup safeguard
  }
}

/**
 * Crops a sub-region from an image file using HTMLCanvasElement.
 * Preserves memory limits and exports a fresh File object.
 * 
 * @param {File} file 
 * @param {Object} cropBox { xPct, yPct, widthPct, heightPct } (0-1 or 0-100)
 * @returns {Promise<File>} Cropped File object
 */
export async function cropImageFile(file, cropBox) {
  if (!file || !cropBox) return file;
  try {
    let img;
    if (typeof createImageBitmap === "function") {
      img = await createImageBitmap(file);
    } else if (typeof URL !== "undefined" && typeof URL.createObjectURL === "function" && typeof Image !== "undefined") {
      img = await new Promise((resolve, reject) => {
        const i = new Image();
        const url = URL.createObjectURL(file);
        i.onload = () => { URL.revokeObjectURL(url); resolve(i); };
        i.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image decode failed")); };
        i.src = url;
      });
    } else {
      return file;
    }

    const imgW = img.width;
    const imgH = img.height;

    // Convert percentages to pixel coordinates
    const xPct = cropBox.xPct !== undefined ? (cropBox.xPct > 1 ? cropBox.xPct / 100 : cropBox.xPct) : 0;
    const yPct = cropBox.yPct !== undefined ? (cropBox.yPct > 1 ? cropBox.yPct / 100 : cropBox.yPct) : 0;
    const wPct = cropBox.widthPct !== undefined ? (cropBox.widthPct > 1 ? cropBox.widthPct / 100 : cropBox.widthPct) : 1;
    const hPct = cropBox.heightPct !== undefined ? (cropBox.heightPct > 1 ? cropBox.heightPct / 100 : cropBox.heightPct) : 1;

    const sx = Math.max(0, Math.min(imgW - 10, Math.round(xPct * imgW)));
    const sy = Math.max(0, Math.min(imgH - 10, Math.round(yPct * imgH)));
    const sw = Math.max(10, Math.min(imgW - sx, Math.round(wPct * imgW)));
    const sh = Math.max(10, Math.min(imgH - sy, Math.round(hPct * imgH)));

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    img.close?.();

    const blob = await new Promise((resolve) => {
      if (typeof canvas.toBlob === "function") {
        canvas.toBlob(resolve, file.type || "image/jpeg", 0.95);
      } else {
        resolve(null);
      }
    });

    cleanupCanvas(canvas);
    if (!blob) return file;

    const nameParts = file.name.split(".");
    const ext = nameParts.length > 1 ? nameParts.pop() : "jpg";
    const croppedName = `${nameParts.join(".")}_cropped.${ext}`;

    return new File([blob], croppedName, {
      type: file.type || "image/jpeg",
      lastModified: Date.now(),
    });
  } catch (err) {
    console.warn("Image crop warning:", err);
    return file;
  }
}




