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
          DEFAULT: 'rgb(var(--color-bg-rgb, 15 23 42) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--color-surface-rgb, 30 41 59) / <alpha-value>)',
          muted: 'rgb(var(--color-surface-muted-rgb, 26 26 26) / <alpha-value>)',
          elevated: 'rgb(var(--color-surface-elevated-rgb, 51 65 85) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--color-text-rgb, 245 245 245) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted-rgb, 148 163 184) / <alpha-value>)',
          subtle: 'rgb(var(--color-text-subtle-rgb, 156 163 175) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--color-border-rgb, 51 65 85) / <alpha-value>)',
          strong: 'rgb(var(--color-border-strong-rgb, 71 85 105) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--color-brand-rgb, 79 70 229) / <alpha-value>)',
          hover: 'rgb(var(--color-brand-hover-rgb, 67 56 202) / <alpha-value>)',
          light: 'rgb(var(--color-brand-light-rgb, 30 27 75) / <alpha-value>)',
          foreground: '#ffffff',
        },
        'accent-orange': {
          DEFAULT: 'rgb(var(--color-accent-orange-rgb, 249 115 22) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-orange-hover-rgb, 234 88 12) / <alpha-value>)',
          light: 'rgb(var(--color-accent-orange-light-rgb, 67 20 7) / <alpha-value>)',
        },
        'attendance-green': {
          DEFAULT: 'rgb(var(--color-attendance-green-rgb, 22 163 74) / <alpha-value>)',
        },
        'attendance-red': {
          DEFAULT: 'rgb(var(--color-attendance-red-rgb, 220 38 38) / <alpha-value>)',
        },
        'attendance-amber': {
          DEFAULT: 'rgb(var(--color-attendance-amber-rgb, 217 119 6) / <alpha-value>)',
        },
        'accent-blue': {
          DEFAULT: 'rgb(var(--color-accent-blue-rgb, 79 70 229) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-blue-hover-rgb, 67 56 202) / <alpha-value>)',
          light: 'rgb(var(--color-accent-blue-light-rgb, 30 27 75) / <alpha-value>)',
        },
        primary: {
          50: 'var(--color-primary-50, #eef2ff)',
          100: 'var(--color-primary-100, #e0e7ff)',
          200: 'var(--color-primary-200, #c7d2fe)',
          300: 'var(--color-primary-300, #a5b4fc)',
          400: 'var(--color-primary-400, #818cf8)',
          500: 'var(--color-primary-500, #6366f1)',
          600: 'var(--color-primary-600, #4f46e5)',
          700: 'var(--color-primary-700, #4338ca)',
          800: 'var(--color-primary-800, #3730a3)',
          900: 'var(--color-primary-900, #312e81)',
          950: 'var(--color-primary-950, #1e1b4b)',
        },
        accent: {
          50: 'var(--color-accent-50, #f8fafc)',
          100: 'var(--color-accent-100, #f1f5f9)',
          200: 'var(--color-accent-200, #e2e8f0)',
          300: 'var(--color-accent-300, #cbd5e1)',
          400: 'var(--color-accent-400, #94a3b8)',
          500: 'var(--color-accent-500, #64748b)',
          600: 'var(--color-accent-600, #475569)',
          700: 'var(--color-accent-700, #334155)',
          800: 'var(--color-accent-800, #1e293b)',
          900: 'var(--color-accent-900, #0f172a)',
          950: 'var(--color-accent-950, #020617)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.35), 0 1px 2px -1px rgb(0 0 0 / 0.25)',
        'card-hover': '0 8px 24px 0 rgb(0 0 0 / 0.45)',
        'card-soft': '0 10px 28px -22px rgb(15 23 42 / 0.95), 0 1px 0 rgb(255 255 255 / 0.03) inset',
        'card-soft-hover': '0 18px 40px -26px rgb(79 70 229 / 0.55), 0 1px 0 rgb(255 255 255 / 0.04) inset',
      },
    },
  },
  plugins: [],
}
