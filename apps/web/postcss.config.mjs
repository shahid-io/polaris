export default {
  plugins: {
    // Tailwind 4 moved its PostCSS integration into a dedicated package,
    // and handles vendor prefixing itself — autoprefixer is no longer needed.
    '@tailwindcss/postcss': {},
  },
};
