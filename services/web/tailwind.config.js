/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#eef7ff',
          100: '#d9ecff',
          200: '#bcdfff',
          300: '#8ccbff',
          400: '#56adff',
          500: '#2e8eff',
          600: '#1670f1',
          700: '#1259d4',
          800: '#1549a8',
          900: '#163f84',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
