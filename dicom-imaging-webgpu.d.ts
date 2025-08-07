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

export { render };
