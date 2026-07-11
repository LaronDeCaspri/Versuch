/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        overdue: "#b91c1c",
        due: "#b45309",
        ok: "#15803d",
        neverdone: "#6d28d9",
      },
      fontFamily: {
        sans: ["Cairo", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
