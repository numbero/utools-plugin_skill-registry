import { defineConfig } from 'vite';
export default defineConfig({
  base: './',
  build: { outDir: 'dist', emptyOutDir: false, target: 'chrome120' },
  plugins: [{
    name: 'production-csp',
    transformIndexHtml(html, context) {
      return context.server ? html : html.replace('<!--csp-->', '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data:; font-src \'self\'; base-uri \'none\'; form-action \'none\'">');
    }
  }]
});
