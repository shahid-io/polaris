/**
 * Named rather than exported anonymously, so the object shows up under a real identifier in
 * stack traces and tooling instead of as an unnamed default.
 */
const postcssConfig = {
  plugins: {
    // Tailwind 4 moved its PostCSS integration into a dedicated package,
    // and handles vendor prefixing itself — autoprefixer is no longer needed.
    '@tailwindcss/postcss': {},
  },
};

export default postcssConfig;
