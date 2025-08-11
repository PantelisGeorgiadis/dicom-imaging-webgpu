import dicomParser from 'dicom-parser';
import pako from 'pako';

import { Cache } from './Cache';
import { FrameDecoder } from './FrameDecoder';
import { Pipeline } from './Pipeline';
import { ImageFrameType } from './types';
import { calculateMinMaxPixelValues, getNumberValues, toTypedPixelData } from './utils';
import { version } from './version';

const imageFrameCache: Cache<ImageFrameType> = new Cache<ImageFrameType>(3);

/**
 * Gets the pixel data from a dataset.
 */
function getPixelData(dataset: dicomParser.DataSet, frameIndex: number = 0): Uint8Array {
  const pixelDataElement = dataset.elements['x7fe00010'] || dataset.elements['x7fe00008'];
  if (!pixelDataElement) {
    throw new Error('Pixel data element was not found');
  }

  return pixelDataElement.encapsulatedPixelData
    ? getEncapsulatedImageFrame(dataset, frameIndex)
    : getUncompressedImageFrame(dataset, frameIndex);
}

function getEncapsulatedImageFrame(
  dataset: dicomParser.DataSet,
  frameIndex: number = 0
): Uint8Array {
  if (dataset.elements['x7fe00010']?.basicOffsetTable?.length) {
    // Basic Offset Table is not empty
    return dicomParser.readEncapsulatedImageFrame(
      dataset,
      dataset.elements['x7fe00010'],
      frameIndex
    );
  }

  // Empty basic offset table
  const numberOfFrames = dataset.intString('x00280008');
  const pixelDataElement = dataset.elements['x7fe00010'];
  const framesAreFragmented =
    pixelDataElement && numberOfFrames !== pixelDataElement.fragments?.length;
  if (framesAreFragmented) {
    const basicOffsetTable = dicomParser.createJPEGBasicOffsetTable(dataset, pixelDataElement);

    return dicomParser.readEncapsulatedImageFrame(
      dataset,
      pixelDataElement,
      frameIndex,
      basicOffsetTable
    );
  }

  return dicomParser.readEncapsulatedPixelDataFromFragments(dataset, pixelDataElement!, frameIndex);
}

/**
 * Gets the uncompressed pixel data from a dataset.
 */
function getUncompressedImageFrame(dataset: dicomParser.DataSet, frameIndex: number): Uint8Array {
  const pixelDataElement = dataset.elements['x7fe00010'] || dataset.elements['x7fe00008'];
  const bitsAllocated = dataset.uint16('x00280100');
  const rows = dataset.uint16('x00280010');
  const columns = dataset.uint16('x00280011');
  const samplesPerPixel = dataset.uint16('x00280002');

  if (!pixelDataElement) {
    throw new Error('Pixel data element is missing');
  }
  if (!bitsAllocated || !rows || !columns || !samplesPerPixel) {
    throw new Error(
      `Missing required attributes [allocated: ${bitsAllocated}, rows: ${rows}, columns: ${columns}, samples: ${samplesPerPixel}]`
    );
  }

  const pixelDataOffset = pixelDataElement.dataOffset;
  const pixelsPerFrame = rows * columns * samplesPerPixel;
  if (bitsAllocated === 8) {
    const frameOffset = pixelDataOffset + frameIndex * pixelsPerFrame;
    if (frameOffset >= dataset.byteArray.length) {
      throw new Error('Frame exceeds size of pixel data');
    }
    return new Uint8Array(
      dataset.byteArray.buffer.slice(frameOffset, frameOffset + pixelsPerFrame)
    );
  } else if (bitsAllocated === 16) {
    const frameOffset = pixelDataOffset + frameIndex * pixelsPerFrame * 2;
    if (frameOffset >= dataset.byteArray.length) {
      throw new Error('Frame exceeds size of pixel data');
    }
    return new Uint8Array(
      dataset.byteArray.buffer.slice(frameOffset, frameOffset + pixelsPerFrame * 2)
    );
  }

  throw new Error(`Unsupported pixel format [Bits allocated: ${bitsAllocated}]`);
}

/**
 * Initializes the frame decoder.
 */
export async function initialize(options?: Record<string, unknown>): Promise<void> {
  await FrameDecoder.initialize(options);
}

/**
 * Renders a dataset.
 */
export async function render(
  gpuDevice: GPUDevice,
  dicomDataBuffer: Uint8Array,
  options?: {
    cacheKey?: string;
    frameIndex?: number;
  }
): Promise<{
  pixelData: Uint8Array | undefined;
  width: number | undefined;
  height: number | undefined;
}> {
  if (!gpuDevice) {
    throw new Error('GPU device is required');
  }
  if (!dicomDataBuffer) {
    throw new Error('DICOM data buffer is required');
  }

  let imageFrame: ImageFrameType | undefined = undefined;
  let imageFrameCreated = false;
  if (options && options.cacheKey) {
    imageFrame = imageFrameCache.get(options.cacheKey);
  }
  if (!imageFrame) {
    imageFrame = createImageFrame(dicomDataBuffer, options);
    imageFrameCreated = true;
  }
  if (options && options.cacheKey && imageFrameCreated) {
    imageFrameCache.set(options.cacheKey, imageFrame);
  }

  const pipeline = Pipeline.create(gpuDevice, imageFrame);
  const renderingResult = await pipeline.render(imageFrame, options);

  return renderingResult;
}

/**
 * Creates an image frame from DICOM data.
 */
function createImageFrame(
  dicomDataBuffer: Uint8Array,
  options?: {
    frameIndex?: number;
  }
): ImageFrameType {
  options = options || {};

  // Parse DICOM dataset
  const dataset = dicomParser.parseDicom(dicomDataBuffer, {
    inflater: (byteArray: Uint8Array, position: number) => {
      const deflated = byteArray.slice(position);
      const inflated = pako.inflateRaw(deflated);

      const completeByteArray = new Uint8Array(inflated.length + position);
      completeByteArray.set(dicomDataBuffer.slice(0, position), 0);
      completeByteArray.set(inflated, position);

      return completeByteArray;
    },
  });

  if (!dataset) {
    throw new Error('Failed to parse DICOM data');
  }

  // Extract transfer syntax UID
  const transferSyntaxUid = dataset.string('x00020010');
  if (!transferSyntaxUid) {
    throw new Error('Transfer syntax UID is missing');
  }

  // Extract pixel data
  const pixelData = getPixelData(dataset, options.frameIndex || 0);
  if (!pixelData) {
    throw new Error('Pixel data is missing');
  }

  // Extract dimensions
  const rows = dataset.uint16('x00280010');
  const columns = dataset.uint16('x00280011');
  if (!rows || !columns) {
    throw new Error('Rows and columns are required');
  }

  // Extract pixel parameters
  const bitsAllocated = dataset.uint16('x00280100') || 0;
  const bitsStored = dataset.uint16('x00280101') || bitsAllocated;
  if (bitsAllocated !== 8 && bitsAllocated !== 16) {
    throw new Error(`Invalid bits allocated value [bits: ${bitsAllocated}]`);
  }

  const pixelRepresentation = dataset.uint16('x00280103') || 0;
  const highBit = dataset.uint16('x00280102') || bitsStored - 1;
  const samplesPerPixel = dataset.uint16('x00280002') || 1;
  let photometricInterpretation = dataset.string('x00280004') || '';
  const planarConfiguration = dataset.uint16('x00280006') || 0;

  // Decode pixel data
  if (!FrameDecoder.isInitialized()) {
    throw new Error('Frame decoder is not initialized');
  }

  const decodedPixelData = FrameDecoder.decodeFrameData(transferSyntaxUid, {
    width: columns,
    height: rows,
    bitsAllocated,
    bitsStored,
    samplesPerPixel,
    pixelRepresentation,
    planarConfiguration,
    photometricInterpretation,
    encodedBuffer: pixelData,
  });

  if (!decodedPixelData || !decodedPixelData.decodedBuffer) {
    throw new Error('Failed to decode pixel data');
  }

  // Photometric interpretation might change
  if (decodedPixelData.photometricInterpretation) {
    photometricInterpretation = decodedPixelData.photometricInterpretation;
  }

  // Make a typed array from pixel data
  const typedPixelData = toTypedPixelData(
    decodedPixelData.decodedBuffer,
    pixelRepresentation,
    bitsAllocated,
    bitsStored,
    highBit
  );

  // Calculate min and max pixel values
  const { minPixelValue, maxPixelValue } = calculateMinMaxPixelValues(typedPixelData);

  // Determine window center and width
  const rescaleIntercept = dataset.floatString('x00281052') || 0.0;
  const rescaleSlope = dataset.floatString('x00281053') || 1.0;

  const wc = getNumberValues(dataset, 'x00281050', 1);
  let windowCenter = Array.isArray(wc) ? wc[0] : wc;
  const ww = getNumberValues(dataset, 'x00281051', 1);
  let windowWidth = Array.isArray(ww) ? ww[0] : ww;
  if (windowCenter === undefined || windowWidth === undefined) {
    const maxVoi = maxPixelValue * rescaleSlope + rescaleIntercept;
    const minVoi = minPixelValue * rescaleSlope + rescaleIntercept;
    windowWidth = maxVoi - minVoi;
    windowCenter = (maxVoi + minVoi) / 2;
  }

  const imageFrame = {
    samplesPerPixel,
    photometricInterpretation,
    planarConfiguration,
    rows,
    columns,
    bitsAllocated,
    bitsStored,
    highBit,
    rescaleIntercept,
    rescaleSlope,
    pixelRepresentation,
    minPixelValue,
    maxPixelValue,
    windowCenter,
    windowWidth,
    pixelData: typedPixelData,
  };

  return imageFrame;
}

/**
 * Export version.
 */
export { version };
