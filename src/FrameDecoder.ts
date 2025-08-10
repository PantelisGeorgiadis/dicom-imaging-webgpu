import { PhotometricInterpretation, TransferSyntax } from './Constants';

type FrameDecoderApi = {
  wasmMemory: WebAssembly.Memory;
  wasmInstance: WebAssembly.Instance;
  wasmModule: WebAssembly.Module;
  functions: Record<string, CallableFunction>;
};

type FrameDecoderContext = {
  width: number;
  height: number;
  bitsAllocated: number;
  bitsStored: number;
  samplesPerPixel: number;
  pixelRepresentation: number;
  planarConfiguration: number;
  photometricInterpretation: string;
  encodedBuffer?: Uint8Array;
  decodedBuffer?: Uint8Array;
};

//#region FrameDecoder
export class FrameDecoder {
  private static _frameDecoderApi: FrameDecoderApi | undefined = undefined;
  private static _wasmFilename = 'dcmjs-native-codecs.wasm';

  /**
   * Initializes the WebAssembly module of the frame decoder.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  static async initialize(options?: Record<string, unknown>): Promise<void> {
    const wasmImports = {
      wasi_snapshot_preview1: {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        environ_get: (envOffset: number, envBufferOffset: number): number => 0,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        environ_sizes_get: (envCount: number, envBufferSize: number): number => 0,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        fd_write: (fd: number, iovsOffset: number, iovsLength: number, nWritten: number): number =>
          0,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        fd_seek: (fd: number, offset: number, whence: number, newOffset: number): number => 0,
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        fd_close: (fd: number): number => 0,
        proc_exit: (rval: number) => {
          throw new Error(`WebAssembly module exited with return value ${rval}`);
        },
      },
      env: {
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        emscripten_notify_memory_growth: (index: number) => {},
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        onCodecsInfo: (pointer: number, len: number) => {},
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        onCodecsTrace: (pointer: number, len: number) => {},
        onCodecsException: (pointer: number, len: number) => {
          const str = this._wasmToJsString(pointer, len);
          throw new Error(str);
        },
      },
    };

    const response = await fetch(this._wasmFilename);
    const { instance, module } = await WebAssembly.instantiateStreaming(response, wasmImports);
    const exports = WebAssembly.Module.exports(module);
    const exportedFunctions = exports.filter((e: { kind: string }) => e.kind === 'function');

    this._frameDecoderApi = {
      wasmInstance: instance,
      wasmModule: module,
      wasmMemory: instance.exports.memory as WebAssembly.Memory,
      functions: {},
    };

    exportedFunctions.forEach((key) => {
      const wasmKey = `wasm${key.name}`;
      this._frameDecoderApi!.functions[wasmKey] = instance.exports[key.name] as CallableFunction;
    });
  }

  /**
   * Checks if the frame decoder is initialized.
   */
  static isInitialized(): boolean {
    return !!this._frameDecoderApi;
  }

  /**
   * Decodes a frame.
   */
  static decodeFrameData(
    transferSyntaxUid: string,
    frameParameters: FrameDecoderContext
  ): FrameDecoderContext {
    if (!frameParameters.encodedBuffer) {
      throw new Error('No encoded buffer provided');
    }

    let decodedContext: FrameDecoderContext | undefined = undefined;
    switch (transferSyntaxUid) {
      case TransferSyntax.ImplicitVRLittleEndian:
      case TransferSyntax.ExplicitVRLittleEndian:
      case TransferSyntax.DeflatedExplicitVRLittleEndian:
        decodedContext = { ...frameParameters };
        decodedContext.decodedBuffer = frameParameters.encodedBuffer;
        break;
      case TransferSyntax.ExplicitVRBigEndian:
        decodedContext = { ...frameParameters };
        decodedContext.decodedBuffer = new Uint8Array(frameParameters.encodedBuffer);
        if (frameParameters.bitsAllocated > 8 && frameParameters.bitsAllocated <= 16) {
          for (let i = 0; i < decodedContext.decodedBuffer.length; i += 2) {
            const holder = decodedContext.decodedBuffer[i];
            decodedContext.decodedBuffer[i] = decodedContext.decodedBuffer[i + 1];
            decodedContext.decodedBuffer[i + 1] = holder;
          }
        }
        break;
      case TransferSyntax.RleLossless:
        decodedContext = this._decodeRle(frameParameters);
        break;
      case TransferSyntax.JpegBaselineProcess1:
      case TransferSyntax.JpegBaselineProcess2_4:
        decodedContext = this._decodeJpeg(frameParameters, { convertColorspaceToRgb: true });
        break;
      case TransferSyntax.JpegLosslessProcess14:
      case TransferSyntax.JpegLosslessProcess14V1:
        decodedContext = this._decodeJpeg(frameParameters);
        break;
      case TransferSyntax.JpegLsLossless:
      case TransferSyntax.JpegLsLossy:
        decodedContext = this._decodeJpegLs(frameParameters);
        break;
      case TransferSyntax.Jpeg2000Lossless:
      case TransferSyntax.Jpeg2000Lossy:
      case TransferSyntax.HtJpeg2000Lossless:
      case TransferSyntax.HtJpeg2000LosslessRpcl:
      case TransferSyntax.HtJpeg2000Lossy:
        decodedContext = this._decodeJpeg2000(frameParameters);
        break;
      default:
        throw new Error(`Unsupported transfer syntax UID: ${transferSyntaxUid}`);
    }

    if (!decodedContext) {
      throw new Error('Failed to decode frame data');
    }

    return {
      width: decodedContext.width,
      height: decodedContext.height,
      bitsAllocated: decodedContext.bitsAllocated,
      bitsStored: decodedContext.bitsStored,
      samplesPerPixel: decodedContext.samplesPerPixel,
      pixelRepresentation: decodedContext.pixelRepresentation,
      planarConfiguration: decodedContext.planarConfiguration,
      photometricInterpretation: decodedContext.photometricInterpretation,
      decodedBuffer: decodedContext.decodedBuffer,
    };
  }

  /**
   * Decodes an RLE frame.
   */
  static _decodeRle(
    context: FrameDecoderContext,
    parameters: Record<string, unknown> = {}
  ): FrameDecoderContext {
    if (!this._frameDecoderApi) {
      throw new Error('WebAssembly module is not initialized');
    }

    const ctx = this._createDecoderContext(context);
    const params = this._createDecoderParameters(parameters);
    this._frameDecoderApi.functions.wasmDecodeRle(ctx, params);
    this._releaseDecoderParameters(params);

    return this._releaseDecoderContext(ctx);
  }

  /**
   * Decodes a JPEG frame.
   */
  static _decodeJpeg(
    context: FrameDecoderContext,
    parameters: Record<string, unknown> = {}
  ): FrameDecoderContext {
    if (!this._frameDecoderApi) {
      throw new Error('WebAssembly module is not initialized');
    }

    const ctx = this._createDecoderContext(context);
    const params = this._createDecoderParameters(parameters);
    this._frameDecoderApi.functions.wasmDecodeJpeg(ctx, params);
    this._releaseDecoderParameters(params);

    return this._releaseDecoderContext(ctx);
  }

  /**
   * Decodes a JPEG-LS frame.
   */
  static _decodeJpegLs(
    context: FrameDecoderContext,
    parameters: Record<string, unknown> = {}
  ): FrameDecoderContext {
    if (!this._frameDecoderApi) {
      throw new Error('WebAssembly module is not initialized');
    }

    const ctx = this._createDecoderContext(context);
    const params = this._createDecoderParameters(parameters);
    this._frameDecoderApi.functions.wasmDecodeJpegLs(ctx, params);
    this._releaseDecoderParameters(params);

    return this._releaseDecoderContext(ctx);
  }

  /**
   * Decodes a JPEG-2000 frame.
   */
  static _decodeJpeg2000(
    context: FrameDecoderContext,
    parameters: Record<string, unknown> = {}
  ): FrameDecoderContext {
    if (!this._frameDecoderApi) {
      throw new Error('WebAssembly module is not initialized');
    }

    const ctx = this._createDecoderContext(context);
    const params = this._createDecoderParameters(parameters);
    this._frameDecoderApi.functions.wasmDecodeJpeg2000(ctx, params);
    this._releaseDecoderParameters(params);

    return this._releaseDecoderContext(ctx);
  }

  /**
   * Creates a decoder context.
   */
  static _createDecoderContext(context: FrameDecoderContext): number {
    if (!this._frameDecoderApi) {
      throw new Error('WebAssembly module is not initialized');
    }

    const ctx = this._frameDecoderApi.functions.wasmCreateCodecsContext();
    this._frameDecoderApi.functions.wasmSetColumns(ctx, context.width);
    this._frameDecoderApi.functions.wasmSetRows(ctx, context.height);
    this._frameDecoderApi.functions.wasmSetBitsAllocated(ctx, context.bitsAllocated);
    this._frameDecoderApi.functions.wasmSetBitsStored(ctx, context.bitsStored);
    this._frameDecoderApi.functions.wasmSetSamplesPerPixel(ctx, context.samplesPerPixel);
    this._frameDecoderApi.functions.wasmSetPixelRepresentation(ctx, context.pixelRepresentation);
    this._frameDecoderApi.functions.wasmSetPlanarConfiguration(ctx, context.planarConfiguration);
    this._frameDecoderApi.functions.wasmSetPhotometricInterpretation(
      ctx,
      Object.values(PhotometricInterpretation).indexOf(context.photometricInterpretation)
    );

    const encodedData = context.encodedBuffer;
    if (encodedData) {
      this._frameDecoderApi.functions.wasmSetEncodedBufferSize(ctx, encodedData.length);
      const encodedDataPointer = this._frameDecoderApi.functions.wasmGetEncodedBuffer(ctx);
      const heap8 = new Uint8Array(this._frameDecoderApi.wasmMemory.buffer);
      heap8.set(encodedData, encodedDataPointer);
    }

    return ctx;
  }

  /**
   * Releases a decoder context.
   */
  static _releaseDecoderContext(ctx: number): {
    width: number;
    height: number;
    bitsAllocated: number;
    bitsStored: number;
    samplesPerPixel: number;
    pixelRepresentation: number;
    planarConfiguration: number;
    photometricInterpretation: string;
    decodedBuffer: Uint8Array;
  } {
    if (!this._frameDecoderApi) {
      throw new Error('WebAssembly module is not initialized');
    }

    const decodedDataPointer = this._frameDecoderApi.functions.wasmGetDecodedBuffer(ctx);
    const decodedDataSize = this._frameDecoderApi.functions.wasmGetDecodedBufferSize(ctx);
    const heap8 = new Uint8Array(this._frameDecoderApi.wasmMemory.buffer);
    const decodedDataView = new Uint8Array(heap8.buffer, decodedDataPointer, decodedDataSize);
    const decodedData = decodedDataView.slice(0);

    const context = {
      width: this._frameDecoderApi.functions.wasmGetColumns(ctx),
      height: this._frameDecoderApi.functions.wasmGetRows(ctx),
      bitsAllocated: this._frameDecoderApi.functions.wasmGetBitsAllocated(ctx),
      bitsStored: this._frameDecoderApi.functions.wasmGetBitsStored(ctx),
      samplesPerPixel: this._frameDecoderApi.functions.wasmGetSamplesPerPixel(ctx),
      pixelRepresentation: this._frameDecoderApi.functions.wasmGetPixelRepresentation(ctx),
      planarConfiguration: this._frameDecoderApi.functions.wasmGetPlanarConfiguration(ctx),
      photometricInterpretation:
        Object.values(PhotometricInterpretation)[
          this._frameDecoderApi.functions.wasmGetPhotometricInterpretation(ctx)
        ],
      decodedBuffer: decodedData,
    };

    this._frameDecoderApi.functions.wasmReleaseCodecsContext(ctx);

    return context;
  }

  /**
   * Creates the decoder parameters.
   */
  static _createDecoderParameters(parameters: { convertColorspaceToRgb?: boolean } = {}): number {
    if (!this._frameDecoderApi) {
      throw new Error('WebAssembly module is not initialized');
    }

    const params = this._frameDecoderApi.functions.wasmCreateDecoderParameters();
    this._frameDecoderApi.functions.wasmSetConvertColorspaceToRgb(
      params,
      parameters.convertColorspaceToRgb || false
    );

    return params;
  }

  /**
   * Releases the decoder parameters.
   */
  static _releaseDecoderParameters(params: number): void {
    if (!this._frameDecoderApi) {
      throw new Error('WebAssembly module is not initialized');
    }

    this._frameDecoderApi.functions.wasmReleaseDecoderParameters(params);
  }

  /**
   * Converts a WebAssembly string to a JS string.
   */
  static _wasmToJsString(pointer: number, len: number): string {
    if (!this._frameDecoderApi) {
      throw new Error('WebAssembly module is not initialized');
    }

    const heap = new Uint8Array(this._frameDecoderApi.wasmMemory.buffer);
    const stringData = new Uint8Array(heap.buffer, pointer, len);
    let str = '';
    for (let i = 0; i < len; i++) {
      str += String.fromCharCode(stringData[i]);
    }

    return str;
  }
}
//#endregion
