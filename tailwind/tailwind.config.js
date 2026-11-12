/** Rebuild with:  npx tailwindcss@3.4.5 -c tailwind/tailwind.config.js -i tailwind/input.css -o static/css/tailwind.css --minify */
module.exports = {
  content: ["./templates/**/*.html", "./static/js/**/*.js"],
  theme: {
    extend: {
      fontFamily: { sans: ['"Plus Jakarta Sans"', "system-ui", "sans-serif"], mono: ['"JetBrains Mono"', "monospace"] },
      colors: {
        ink: { 950: "#05080f", 900: "#0a0f1c", 800: "#111829", 700: "#1a2236" },
        lens: { 300: "#7ff3e0", 400: "#2dd4bf", 500: "#14b8a6", 600: "#0d9488" },
      },
    },
  },
};
