/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,ts}'],
  theme: { extend: {} },
  plugins: [],
  corePlugins: {
    preflight: false  // avoid conflicts with Angular Material reset
  }
};
