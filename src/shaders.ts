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
    center: f32,
    width: f32
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
@group(0) @binding(1) var <storage, read_write> renderedPixelData: array<vec4<f32>>;

@compute @workgroup_size(8, 8)
fn main(
    @builtin(global_invocation_id) global_id: vec3<u32>
) {
    if (global_id.x > imageFrame.dimensions.columns || global_id.y > imageFrame.dimensions.rows) {
        return;
    }

    // Get pixel
    let idx = (imageFrame.dimensions.columns * global_id.y) + global_id.x;
    let p = imageFrame.pixelData[idx];

    // Apply rescale LUT
    let s = p * imageFrame.scaling.slope + imageFrame.scaling.intercept;

    // Apply VOI LUT
    let centerMin05 = imageFrame.window.center - 0.5;
    let widthMin1 = imageFrame.window.width - 1.0;
    let widthDiv2 = widthMin1 / 2.0;
    let v = (((s - centerMin05) / widthMin1 + 0.5) * 255.0);

    // Clamp to [0, 255]
    let c = clamp(v, 0.0, 255.0);

    // Invert if needed
    var r: f32 = c;
    if imageFrame.lut.invert > 0u {
        r = 255.0 - c;
    }

    // Write the result
    renderedPixelData[idx] = vec4<f32> (r, r, r, 255.0);
}
`;
