import { Cache } from './Cache';
import { GrayscaleShader } from './shaders';
import { ImageFrameType } from './types';

//#region Pipeline
export class Pipeline {
  private static readonly pipelineCache: Cache<Pipeline> = new Cache<Pipeline>(5);

  /**
   * Initializes the pipeline.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  initialize(gpuDevice: GPUDevice): void {
    throw new Error('initialize should be implemented');
  }

  /**
   * Renders using the pipeline.
   */
  async render(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    imageFrame: ImageFrameType,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: Record<string, unknown>
  ): Promise<{
    pixelData: Uint8Array | undefined;
    width: number | undefined;
    height: number | undefined;
  }> {
    throw new Error('render should be implemented');
  }

  /**
   * Creates the proper pipeline.
   */
  static create(gpuDevice: GPUDevice, imageFrame: ImageFrameType): Pipeline {
    if (!imageFrame.photometricInterpretation) {
      throw new Error('Photometric interpretation is required to construct a rendering pipeline');
    }

    const cachedPipeline = this.pipelineCache.get(imageFrame.photometricInterpretation);
    if (cachedPipeline !== undefined) {
      return cachedPipeline;
    }

    if (
      imageFrame.photometricInterpretation === 'MONOCHROME1' ||
      imageFrame.photometricInterpretation === 'MONOCHROME2'
    ) {
      const grayscalePipeline = new GrayscalePipeline();
      grayscalePipeline.initialize(gpuDevice);
      this.pipelineCache.set(imageFrame.photometricInterpretation, grayscalePipeline);

      return grayscalePipeline;
    } else if (imageFrame.photometricInterpretation === 'RGB') {
      const colorPipeline = new ColorRgbPipeline();
      colorPipeline.initialize(gpuDevice);
      this.pipelineCache.set(imageFrame.photometricInterpretation, colorPipeline);

      return colorPipeline;
    } else {
      throw new Error(
        `Unsupported photometric interpretation: ${imageFrame.photometricInterpretation}`
      );
    }
  }
}
//#endregion

//#region GrayscalePipeline
class GrayscalePipeline extends Pipeline {
  private device: GPUDevice | undefined = undefined;
  private computePipeline: GPUComputePipeline | undefined = undefined;
  private bindGroupLayout: GPUBindGroupLayout | undefined = undefined;

  /**
   * Initializes the grayscale pipeline.
   */
  initialize(gpuDevice: GPUDevice): void {
    // Shader module (minify code - remove multiple line breaks and comments)
    const shaderModule = gpuDevice.createShaderModule({
      label: 'Grayscale shader module',
      code: GrayscaleShader.replace(/\n\s*\n/g, '\n').replace(
        /\/\*[\s\S]*?\*\/|(?<=[^:])\/\/.*|^\/\/.*/g,
        ''
      ),
    });

    // Bind group layout
    const bindGroupLayout = gpuDevice.createBindGroupLayout({
      label: 'Grayscale bind group layout',
      entries: [
        {
          binding: 0,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: 'read-only-storage',
          },
        },
        {
          binding: 1,
          visibility: GPUShaderStage.COMPUTE,
          buffer: {
            type: 'storage',
          },
        },
      ],
    });

    // Pipeline layout
    const pipelineLayout = gpuDevice.createPipelineLayout({
      bindGroupLayouts: [bindGroupLayout],
    });

    // Compute pipeline
    const computePipeline = gpuDevice.createComputePipeline({
      label: 'Grayscale compute pipeline',
      layout: pipelineLayout,
      compute: {
        module: shaderModule,
        entryPoint: 'main',
      },
    });

    this.device = gpuDevice;
    this.bindGroupLayout = bindGroupLayout;
    this.computePipeline = computePipeline;
  }

  /**
   * Renders a grayscale image frame on GPU.
   */
  async render(
    imageFrame: ImageFrameType,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: Record<string, unknown>
  ): Promise<{
    pixelData: Uint8Array | undefined;
    width: number | undefined;
    height: number | undefined;
  }> {
    if (
      this.device === undefined ||
      this.computePipeline === undefined ||
      this.bindGroupLayout === undefined
    ) {
      throw new Error('Pipeline is not initialized');
    }

    const {
      rows,
      columns,
      rescaleSlope,
      rescaleIntercept,
      windowCenter,
      windowWidth,
      pixelData,
      photometricInterpretation,
    } = imageFrame;
    const shouldInvert = photometricInterpretation === 'MONOCHROME1' ? 1 : 0;

    // Calculate the size of the pixel data as f32
    // Add extra image frame parameters to front and meet 16-byte alignment
    const dataSize = rows * columns * 4;
    const rgbaDataSize = 4 * dataSize;
    const bufferSize = dataSize + 32;
    const alignedBufferSize = Math.ceil(bufferSize / 16) * 16;

    // Create a buffer on the GPU to hold pixel computation input
    const imageFrameBuffer = this.device.createBuffer({
      label: 'Image frame buffer input',
      size: alignedBufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });

    // Create a buffer on the GPU to hold pixel computation output
    const renderedPixelDataBuffer = this.device.createBuffer({
      label: 'Pixel data buffer output',
      size: 4 * bufferSize, // RGBA format
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // Create a staging buffer
    const stagingBuffer = this.device.createBuffer({
      label: 'Pixel data staging buffer',
      size: rgbaDataSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      label: 'Grayscale bind group',
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: imageFrameBuffer } },
        { binding: 1, resource: { buffer: renderedPixelDataBuffer } },
      ],
    });

    // Encode image frame parameters
    this.device.queue.writeBuffer(imageFrameBuffer, 0, new Int32Array([columns, rows]));
    this.device.queue.writeBuffer(
      imageFrameBuffer,
      8,
      new Float32Array([rescaleSlope, rescaleIntercept])
    );
    this.device.queue.writeBuffer(
      imageFrameBuffer,
      16,
      new Float32Array([windowCenter - 0.5, windowWidth - 1.0])
    );
    this.device.queue.writeBuffer(imageFrameBuffer, 24, new Float32Array([0, shouldInvert]));

    // Set pixel data
    const typedPixelData = pixelData;
    const float32PixelData = new Float32Array(typedPixelData.length);
    float32PixelData.set(typedPixelData);
    this.device.queue.writeBuffer(imageFrameBuffer, 32, float32PixelData);

    // Encode commands to do the computation
    const encoder = this.device.createCommandEncoder({
      label: 'Grayscale encoder',
    });
    const computePass = encoder.beginComputePass({
      label: 'Grayscale compute pass',
    });
    computePass.setPipeline(this.computePipeline);
    computePass.setBindGroup(0, bindGroup);
    computePass.dispatchWorkgroups(Math.ceil(columns / 16), Math.ceil(rows / 16));
    computePass.end();

    // Copy the results to the staging buffer
    encoder.copyBufferToBuffer(renderedPixelDataBuffer, 0, stagingBuffer, 0, rgbaDataSize);

    // Finish encoding and submit the commands
    const commandBuffer = encoder.finish();
    this.device.queue.submit([commandBuffer]);

    // Read the results
    await stagingBuffer.mapAsync(GPUMapMode.READ, 0, rgbaDataSize);
    const result = new Uint32Array(stagingBuffer.getMappedRange(0, rgbaDataSize).slice());
    stagingBuffer.unmap();

    // Destroy buffers
    stagingBuffer.destroy();
    imageFrameBuffer.destroy();
    renderedPixelDataBuffer.destroy();

    // Convert the result to RGBA bytes (it is already clamped in the shader)
    const rgbaPixels = new Uint8Array(4 * rows * columns);
    rgbaPixels.set(result);

    return {
      pixelData: rgbaPixels,
      width: columns,
      height: rows,
    };
  }
}
//#endregion

//#region ColorRgbPipeline
class ColorRgbPipeline extends Pipeline {
  /**
   * Initializes the color pipeline.
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  initialize(gpuDevice: GPUDevice): void {}

  /**
   * Renders a color image frame.
   */
  async render(
    imageFrame: ImageFrameType,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    options?: Record<string, unknown>
  ): Promise<{
    pixelData: Uint8Array | undefined;
    width: number | undefined;
    height: number | undefined;
  }> {
    const { rows, columns, pixelData, planarConfiguration } = imageFrame;
    const shouldConvertToInterleaved = planarConfiguration === 1;

    const rgbaPixels = new Uint8Array(4 * rows * columns);
    for (let i = 0, p = 0; i < rows * columns; i++, p += 4) {
      rgbaPixels[p] = shouldConvertToInterleaved ? pixelData[i] : pixelData[i * 3];
      rgbaPixels[p + 1] = shouldConvertToInterleaved
        ? pixelData[i + rows * columns]
        : pixelData[i * 3 + 1];
      rgbaPixels[p + 2] = shouldConvertToInterleaved
        ? pixelData[i + 2 * rows * columns]
        : pixelData[i * 3 + 2];
      rgbaPixels[p + 3] = 0xff;
    }

    return {
      pixelData: rgbaPixels,
      width: columns,
      height: rows,
    };
  }
}
//#endregion
