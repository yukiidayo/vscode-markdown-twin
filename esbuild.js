const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/extension.ts'],
  bundle: true,
  outfile: 'dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  sourcemap: true,
  minify: false,
  legalComments: 'linked', // ライセンス文を dist/extension.js.LEGAL.txt に出力
}).catch(() => process.exit(1));
