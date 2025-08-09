import babel from '@rollup/plugin-babel';
import commonjs from '@rollup/plugin-commonjs';
import resolve from '@rollup/plugin-node-resolve';
import fg from 'fast-glob';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { RollupOptions } from 'rollup';
import dts from 'rollup-plugin-dts';
import serve from 'rollup-plugin-serve';
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
    resolve({
      browser: true,
    }),
    commonjs(),
    babel({
      babelHelpers: 'bundled',
      exclude: 'node_modules/**',
    }),
    {
      name: 'watch-external',
      async buildStart() {
        const files = await fg('src/**/*.ts');
        for (const file of files) {
          this.addWatchFile(file);
        }
      },
    },
    serve({
      contentBase: ['build', 'static', 'wasm'],
      host: 'localhost',
      onListening: function (server: Server) {
        const address = server.address() as AddressInfo;
        const host = address.address === '::' ? 'localhost' : address.address;
        console.log(`Server listening at http://${host}:${address.port}/`);
      },
      port: 10001,
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
