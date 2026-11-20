/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        boteco: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
        dark: {
          50: '#eef2ff',
          100: '#e0e7ff',
          200: '#c7d2fe',
          800: '#1e1b4b',
          900: '#0f0d2e',
          950: '#080620',
        },
      },
    },
  },
  plugins: [],
}
