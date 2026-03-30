/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./App.{js,jsx,ts,tsx}", "./src/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        'aether-dark': '#0B0D17',
        'aether-glass': 'rgba(255, 255, 255, 0.05)',
        'aether-accent': '#7C3AED',
      }
    },
  },
  plugins: [],
}
