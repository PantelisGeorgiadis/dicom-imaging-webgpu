import dicomParser from 'dicom-parser';

import { PixelDataType } from './types';

export function toTypedPixelData(
  pixelData: Uint8Array,
  pixelRepresentation: number,
  bitsAllocated: number,
  bitsStored: number,
  highBit: number
): PixelDataType {
  let typedPixelData: PixelDataType;
  if (bitsStored === 8 && highBit === 7 && bitsAllocated === 8) {
    typedPixelData = pixelData;
  } else if (bitsAllocated <= 16) {
    if (pixelRepresentation === 0) {
      typedPixelData = new Uint16Array(
        pixelData.buffer,
        pixelData.byteOffset,
        pixelData.byteLength / Uint16Array.BYTES_PER_ELEMENT
      );
    } else {
      const u16 = new Uint16Array(
        pixelData.buffer,
        pixelData.byteOffset,
        pixelData.byteLength / Uint16Array.BYTES_PER_ELEMENT
      );
      typedPixelData = new Int16Array(u16);
    }
  } else {
    throw new Error(`Unsupported pixel data value for bits stored: ${bitsStored}`);
  }

  return typedPixelData;
}

export function getNumberValues(
  dataSet: dicomParser.DataSet | undefined,
  tag: string,
  minimumLength: number
): number[] | undefined {
  if (!dataSet) {
    throw new Error('Dataset is required');
  }

  const valueAsString = dataSet.string(tag);
  if (!valueAsString) {
    return undefined;
  }

  const split = valueAsString.split('\\');
  if (minimumLength && split.length < minimumLength) {
    return undefined;
  }

  return split.map((v) => parseFloat(v));
}

export function calculateMinMaxPixelValues(pixelData: PixelDataType): {
  minPixelValue: number;
  maxPixelValue: number;
} {
  let minPixelValue = pixelData[0];
  let maxPixelValue = minPixelValue;

  for (let i = 0; i < pixelData.length; i++) {
    const currentValue = pixelData[i]!;
    if (currentValue < minPixelValue) {
      minPixelValue = currentValue;
    } else if (currentValue > maxPixelValue) {
      maxPixelValue = currentValue;
    }
  }

  return { minPixelValue, maxPixelValue };
}
