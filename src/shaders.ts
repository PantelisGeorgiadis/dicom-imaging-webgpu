export const GrayscaleShader: string = `
struct Dimensions {
    columns: u32,
    rows: u32
}

struct Scale {
    slope: f32,
    intercept: f32
}

struct Window {
    centerMin05: f32,
    widthMin1: f32
}

struct Lut {
    reserved: u32,
    invert: u32
}

struct ImageFrame {
    dimensions: Dimensions,
    scaling: Scale,
    window: Window,
    lut: Lut,
    pixelData: array<f32>
}

@group(0) @binding(0) var <storage, read> imageFrame: ImageFrame;
@group(0) @binding(1) var <storage, read_write> renderedPixelData: array<vec4<u32>>;

@compute @workgroup_size(16, 16)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    if (global_id.x > imageFrame.dimensions.columns || global_id.y > imageFrame.dimensions.rows) {
        return;
    }

    // Current index
    let idx: u32 = imageFrame.dimensions.columns * global_id.y + global_id.x;

    // Apply rescale LUT
    let s: f32 = imageFrame.pixelData[idx] * imageFrame.scaling.slope + imageFrame.scaling.intercept;

    // Apply VOI LUT
    let v: f32 = (((s - imageFrame.window.centerMin05) / imageFrame.window.widthMin1 + 0.5) * 255.0);

    // Clamp to [0, 255]
    let c: u32 = u32(clamp(v, 0.0, 255.0));

    // Invert if needed
    let r: u32 = select(c, 255u - c, imageFrame.lut.invert > 0u);

    // Write the result
    renderedPixelData[idx] = vec4<u32>(r, r, r, 255u);
}
`;
