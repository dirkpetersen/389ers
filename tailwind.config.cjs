/** @type {import('tailwindcss').Config} */
// CommonJS on purpose — see the note in postcss.config.cjs.
module.exports = {
  content: [
    "./src/client/index.html",
    "./src/client/src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'osu-orange': '#D73F09',
        'osu-orange-dark': '#B33507',
        'osu-black': '#000000',
        'osu-gray': '#4A4A4A',
      },
    },
  },
  plugins: [],
}
