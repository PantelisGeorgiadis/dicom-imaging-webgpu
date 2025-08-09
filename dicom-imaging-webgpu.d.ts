declare const version = "0.0.2";

/**
 * Initializes the frame decoder.
 */
declare function initialize(options?: Record<string, unknown>): Promise<void>;
/**
 * Renders a dataset.
 */
declare function render(gpuDevice: GPUDevice, dicomDataBuffer: Uint8Array, options?: {
    frameIndex?: number;
}): Promise<{
    pixelData: Uint8Array | undefined;
    width: number | undefined;
    height: number | undefined;
}>;

export { initialize, render, version };
