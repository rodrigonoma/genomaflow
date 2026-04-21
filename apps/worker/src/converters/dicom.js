const dcmjs = require('dcmjs');
const Jimp = require('jimp');

const WINDOW_DEFAULTS = {
  CT: { center: 40,  width: 400  },
  CR: { center: 128, width: 256  },
  DX: { center: 128, width: 256  },
  MR: { center: 512, width: 1024 },
  US: { center: 128, width: 256  },
};

function getTag(dict, tag) {
  return dict[tag]?.Value?.[0] ?? null;
}

/**
 * Converte buffer DICOM para PNG com windowing diagnóstico.
 * Suporta DICOM 16-bit e 8-bit não comprimidos.
 * @param {Buffer} buffer
 * @returns {Promise<{ pngBuffer: Buffer, meta: object }>}
 */
async function dicomToImage(buffer) {
  const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  const dataSet = dcmjs.data.DicomMessage.readFile(arrayBuffer);
  const dict = dataSet.dict;

  const modality     = getTag(dict, '00080060');
  const rows         = getTag(dict, '00280010');
  const cols         = getTag(dict, '00280011');
  const bitsAlloc    = getTag(dict, '00280100') ?? 16;
  const windowCenter = getTag(dict, '00281050');
  const windowWidth  = getTag(dict, '00281051');

  if (!rows || !cols) throw new Error('DICOM: dimensões de imagem ausentes no header');

  const pixelDataElem = dict['7FE00010'];
  if (!pixelDataElem?.Value?.[0]) throw new Error('DICOM: pixel data ausente ou comprimido — use JPG/PNG para imagens comprimidas');

  const defaults = WINDOW_DEFAULTS[modality] ?? WINDOW_DEFAULTS.CR;
  const wc = Number(windowCenter ?? defaults.center);
  const ww = Number(windowWidth  ?? defaults.width);
  const lo = wc - ww / 2;
  const hi = wc + ww / 2;

  const rawBuf    = pixelDataElem.Value[0].buffer;
  const pixelData = bitsAlloc === 8
    ? new Uint8Array(rawBuf)
    : new Uint16Array(rawBuf);

  const img = new Jimp(cols, rows);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const raw = pixelData[r * cols + c];
      let v = Math.round(((raw - lo) / (hi - lo)) * 255);
      v = Math.max(0, Math.min(255, v));
      const hex = Jimp.rgbaToInt(v, v, v, 255);
      img.setPixelColor(hex, c, r);
    }
  }

  const pngBuffer = await img.getBufferAsync(Jimp.MIME_PNG);

  const meta = {
    modality,
    bodyPart:   getTag(dict, '00180015'),
    studyDesc:  getTag(dict, '00081030'),
    seriesDesc: getTag(dict, '0008103E'),
    rows,
    cols,
    windowCenter: wc,
    windowWidth:  ww,
  };

  return { pngBuffer, meta };
}

function formatDicomMeta(meta) {
  return [
    meta.modality   && `Modality: ${meta.modality}`,
    meta.bodyPart   && `Body Part: ${meta.bodyPart}`,
    meta.studyDesc  && `Study: ${meta.studyDesc}`,
    meta.seriesDesc && `Series: ${meta.seriesDesc}`,
  ].filter(Boolean).join('\n');
}

module.exports = { dicomToImage, formatDicomMeta };
