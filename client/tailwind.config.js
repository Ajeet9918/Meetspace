/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        paper: '#EFF1F3',
        surface: '#FFFFFF',
        ink: { DEFAULT: '#15171B', soft: '#464C54', faint: '#666D76' },
        rule: '#CDD1D6',
        edge: '#8A9099',
        tally: '#E5352F',
        danger: '#B42318',
        focus: '#2F5BEA',
      },
      fontFamily: { sans: ['"Schibsted Grotesk Variable"', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
};