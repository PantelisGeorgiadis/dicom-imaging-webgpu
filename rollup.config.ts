import babel from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import { RollupOptions } from 'rollup';
import dts from 'rollup-plugin-dts';
import typescript from 'rollup-plugin-typescript2';

const config: RollupOptions = {
  input: 'dist/index.js',
  output: {
    file: 'build/dicom-imaging-webgpu.js',
    format: 'umd',
    name: 'dicomImagingWebGpu',
    sourcemap: true,
  },
  plugins: [
    typescript(),
    terser(),
    resolve({
      browser: true,
    }),
    commonjs(),
    babel({
      babelHelpers: 'bundled',
      exclude: 'node_modules/**',
    }),
  ],
};

const dtsConfig: RollupOptions = {
  input: 'dist/index.d.ts',
  output: {
    file: 'build/dicom-imaging-webgpu.d.ts',
    format: 'es',
  },
  plugins: [dts()],
};

export default [config, dtsConfig];
