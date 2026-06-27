/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: {
          DEFAULT: 'rgb(var(--color-bg-rgb, 13 21 18) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--color-surface-rgb, 20 31 27) / <alpha-value>)',
          muted: 'rgb(var(--color-surface-muted-rgb, 17 29 24) / <alpha-value>)',
          elevated: 'rgb(var(--color-surface-elevated-rgb, 30 45 38) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--color-text-rgb, 230 240 236) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted-rgb, 142 169 154) / <alpha-value>)',
          subtle: 'rgb(var(--color-text-subtle-rgb, 104 133 119) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--color-border-rgb, 31 51 43) / <alpha-value>)',
          strong: 'rgb(var(--color-border-strong-rgb, 42 66 55) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--color-brand-rgb, 20 184 166) / <alpha-value>)',
          hover: 'rgb(var(--color-brand-hover-rgb, 45 212 191) / <alpha-value>)',
          light: 'rgb(var(--color-brand-light-rgb, 19 78 68) / <alpha-value>)',
          foreground: '#ffffff',
        },
        'accent-orange': {
          DEFAULT: 'rgb(var(--color-accent-orange-rgb, 245 158 11) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-orange-hover-rgb, 217 119 6) / <alpha-value>)',
          light: 'rgb(var(--color-accent-orange-light-rgb, 74 46 5) / <alpha-value>)',
        },
        'attendance-green': {
          DEFAULT: 'rgb(var(--color-attendance-green-rgb, 34 197 94) / <alpha-value>)',
        },
        'attendance-red': {
          DEFAULT: 'rgb(var(--color-attendance-red-rgb, 239 68 68) / <alpha-value>)',
        },
        'attendance-amber': {
          DEFAULT: 'rgb(var(--color-attendance-amber-rgb, 245 158 11) / <alpha-value>)',
        },
        'accent-blue': {
          DEFAULT: 'rgb(var(--color-accent-blue-rgb, 20 184 166) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-blue-hover-rgb, 13 148 136) / <alpha-value>)',
          light: 'rgb(var(--color-accent-blue-light-rgb, 19 78 68) / <alpha-value>)',
        },
        primary: {
          50: 'var(--color-primary-50, #ecfdf5)',
          100: 'var(--color-primary-100, #d1fae5)',
          200: 'var(--color-primary-200, #a7f3d0)',
          300: 'var(--color-primary-300, #6ee7b7)',
          400: 'var(--color-primary-400, #34d399)',
          500: 'var(--color-primary-500, #10b981)',
          600: 'var(--color-primary-600, #059669)',
          700: 'var(--color-primary-700, #047857)',
          800: 'var(--color-primary-800, #065f46)',
          900: 'var(--color-primary-900, #064e3b)',
          950: 'var(--color-primary-950, #022c22)',
        },
        accent: {
          50: 'var(--color-accent-50, #f0f5f2)',
          100: 'var(--color-accent-100, #d1dfd8)',
          200: 'var(--color-accent-200, #a8c4b8)',
          300: 'var(--color-accent-300, #7ba697)',
          400: 'var(--color-accent-400, #5a8d7c)',
          500: 'var(--color-accent-500, #3d7563)',
          600: 'var(--color-accent-600, #2d5e4f)',
          700: 'var(--color-accent-700, #1f473b)',
          800: 'var(--color-accent-800, #133028)',
          900: 'var(--color-accent-900, #0a1a15)',
          950: 'var(--color-accent-950, #040d09)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        card: '0 10px 26px -24px rgb(13 148 136 / 0.34), 0 1px 2px -1px rgb(13 21 18 / 0.18)',
        'card-hover': '0 18px 38px -28px rgb(13 148 136 / 0.42), 0 3px 10px -8px rgb(13 21 18 / 0.25)',
        'card-soft': '0 12px 28px -25px rgb(13 148 136 / 0.36), 0 1px 0 rgb(255 255 255 / 0.035) inset',
        'card-soft-hover': '0 18px 42px -30px rgb(13 148 136 / 0.46), 0 1px 0 rgb(255 255 255 / 0.045) inset',
      },
    },
  },
  plugins: [],
}
