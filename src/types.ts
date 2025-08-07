export type PixelDataType = Uint8Array | Int16Array | Uint16Array;

export type ImageFrameType = {
  samplesPerPixel: number;
  photometricInterpretation: string;
  planarConfiguration: number;
  rows: number;
  columns: number;
  bitsAllocated: number;
  bitsStored: number;
  highBit: number;
  rescaleIntercept: number;
  rescaleSlope: number;
  pixelRepresentation: number;
  minPixelValue: number;
  maxPixelValue: number;
  windowCenter: number;
  windowWidth: number;
  pixelData: PixelDataType;
};

export type RenderingResultType = {
  width: number;
  height: number;
  pixelData: Uint8Array;
  time: number;
};
