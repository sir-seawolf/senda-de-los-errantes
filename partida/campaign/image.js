export function imageAttempts(width, height) {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1 || width * height > 40000000) {
    throw Error('Imagen demasiado grande o no válida. Elige otra imagen (máximo 40 megapíxeles).');
  }
  const result = [];
  for (const edge of [512, 384, 256, 192, 128]) {
    const scale = Math.min(1, edge / Math.max(width, height));
    for (const quality of [0.85, 0.7, 0.55, 0.4]) {
      result.push({width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)), quality});
    }
  }
  return result;
}

export async function fitWebP(width, height, encode) {
  for (const attempt of imageAttempts(width, height)) {
    const blob = await encode(attempt);
    if (blob?.type === 'image/webp' && blob.size > 0 && blob.size <= 150000) {
      return blob;
    }
  }
  throw Error('No se ha conseguido una WebP de 150.000 bytes o menos. Elige otra imagen.');
}

export async function withoutMetadata(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(bytes.buffer);
  const label = offset => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  if (bytes.length < 20 || label(0) !== 'RIFF' || label(8) !== 'WEBP' || view.getUint32(4, true) + 8 !== bytes.length) {
    throw Error('El navegador no ha producido una WebP válida.');
  }
  const chunks = [];
  for (let offset = 12; offset < bytes.length;) {
    if (offset + 8 > bytes.length) {
      throw Error('WebP truncada.');
    }
    const size = view.getUint32(offset + 4, true);
    const end = offset + 8 + size + (size & 1);
    const kind = label(offset);
    if (end > bytes.length || ['ANIM', 'ANMF'].includes(kind)) {
      throw Error('La salida debe ser una WebP estática.');
    }
    if (['VP8X', 'ALPH', 'VP8 ', 'VP8L'].includes(kind)) {
      const chunk = bytes.slice(offset, end);
      if (kind === 'VP8X') {
        if (size !== 10 || chunk[8] & 2) {
          throw Error('La salida debe ser una WebP estática.');
        }
        // Conservar alfa y las dimensiones; eliminar indicadores de metadatos.
        chunk[8] &= 0x10;
      }
      chunks.push(chunk);
    } else if (!['ICCP', 'EXIF', 'XMP '].includes(kind)) {
      throw Error('La WebP contiene una estructura no soportada.');
    }
    offset = end;
  }
  const header = bytes.slice(0, 12);
  new DataView(header.buffer).setUint32(4, 4 + chunks.reduce((total, chunk) => total + chunk.length, 0), true);
  return new Blob([header, ...chunks], {type: 'image/webp'});
}

export async function reduceImage(file) {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 20000000) {
    throw Error('Elige una imagen JPEG, PNG o WebP de hasta 20 MB.');
  }
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
    const canvas = document.createElement('canvas');
    const reduced = await fitWebP(bitmap.width, bitmap.height, ({width, height, quality}) => {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext('2d');
      if (!context) {
        throw Error('Este navegador no permite preparar la imagen.');
      }
      context.drawImage(bitmap, 0, 0, width, height);
      return new Promise(resolve => canvas.toBlob(resolve, 'image/webp', quality));
    });
    return await withoutMetadata(reduced);
  } finally {
    bitmap?.close();
  }
}
