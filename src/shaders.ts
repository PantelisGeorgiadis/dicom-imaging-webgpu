export const GrayscaleShader: string = `
struct ImageFrame {
  size: vec2<u32>, // x: columns, y: rows
  scale: vec2<f32>, // x: slope, y: intercept
  window: vec2<f32>, // x: center, y: width
  minMax: vec2<f32>, // x: min, y: max
  pixelData: array<f32>
}

@group(0) @binding(0) var<storage, read> imageFrame: ImageFrame;
@group(0) @binding(1) var<storage, read_write> renderedPixelData: array<f32>;

@compute @workgroup_size(8, 8)
fn main(
  @builtin(global_invocation_id) global_id: vec3<u32>
){
  if(global_id.x > imageFrame.size.x || global_id.y > imageFrame.size.y) {
    return;
  }

  let idx = (imageFrame.size.x * global_id.y) + global_id.x;
  let p = imageFrame.pixelData[idx];
  
  // Rescale LUT
  let s = p * imageFrame.scale.x + imageFrame.scale.y;

  // VOI LUT
  let centerMin05 = imageFrame.window.x - 0.5;
  let widthMin1 = imageFrame.window.y - 1.0;
  let widthDiv2 = widthMin1 / 2.0;
  let v = (((s - centerMin05) / widthMin1 + 0.5) * 255.0);
  
  let c = clamp(v, 0.0, 255.0);

  renderedPixelData[idx] = c;
}
`;
