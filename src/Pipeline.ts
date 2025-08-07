import { PipelineCache } from './PipelineCache';
import { GrayscaleShader } from './shaders';
import { ImageFrameType } from './types';

//#region Pipeline
export class Pipeline {
  private static readonly pipelineCache: PipelineCache = new PipelineCache(5);

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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async render(
    imageFrame: ImageFrameType,
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
    // Shader module
    const shaderModule = gpuDevice.createShaderModule({
      label: 'Grayscale shader module',
      code: GrayscaleShader,
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
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async render(
    imageFrame: ImageFrameType,
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
      minPixelValue,
      maxPixelValue,
      photometricInterpretation,
    } = imageFrame;
    const shouldInvert = photometricInterpretation === 'MONOCHROME1';

    // Calculate the size of the pixel data as f32
    // Add extra image frame parameters to front and meet 16-byte alignment
    const dataSize = rows * columns * 4;
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
      size: bufferSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });

    // Create a staging buffer
    const stagingBuffer = this.device.createBuffer({
      label: 'Pixel data staging buffer',
      size: dataSize,
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
      new Float32Array([windowCenter, windowWidth])
    );
    this.device.queue.writeBuffer(
      imageFrameBuffer,
      24,
      new Float32Array([minPixelValue, maxPixelValue])
    );

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
    computePass.dispatchWorkgroups(Math.ceil(columns / 8), Math.ceil(rows / 8));
    computePass.end();

    encoder.copyBufferToBuffer(renderedPixelDataBuffer, 0, stagingBuffer, 0, dataSize);

    // Finish encoding and submit the commands
    const commandBuffer = encoder.finish();
    this.device.queue.submit([commandBuffer]);

    // Read the results
    await stagingBuffer.mapAsync(GPUMapMode.READ, 0, dataSize);
    const result = new Float32Array(stagingBuffer.getMappedRange(0, dataSize).slice());
    stagingBuffer.unmap();

    // Destroy buffers
    imageFrameBuffer.destroy();
    renderedPixelDataBuffer.destroy();

    const rgbaPixels = new Uint8Array(4 * rows * columns);
    for (let i = 0, p = 0; i < rows * columns; i++) {
      const pixel = shouldInvert ? 0xff - Math.trunc(result[i]) : Math.trunc(result[i]);
      rgbaPixels[p++] = pixel;
      rgbaPixels[p++] = pixel;
      rgbaPixels[p++] = pixel;
      rgbaPixels[p++] = 0xff;
    }

    return {
      pixelData: rgbaPixels,
      width: columns,
      height: rows,
    };
  }
}
//#endregion
