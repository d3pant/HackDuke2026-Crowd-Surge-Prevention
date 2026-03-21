/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#1A56DB',
        critical: '#EF4444',
        warning: '#F97316',
        watch: '#EAB308',
        safe: '#22C55E',
        surface: '#1E293B',
        border: '#334155',
        canvas: '#0F172A',
        ink: '#F1F5F9',
        muted: '#94A3B8',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      width: {
        85: '21.25rem',
      },
    },
  },
  plugins: [],
}
