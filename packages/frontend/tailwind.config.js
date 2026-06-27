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
          DEFAULT: 'rgb(var(--color-bg-rgb, 15 16 26) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--color-surface-rgb, 24 25 35) / <alpha-value>)',
          muted: 'rgb(var(--color-surface-muted-rgb, 19 20 30) / <alpha-value>)',
          elevated: 'rgb(var(--color-surface-elevated-rgb, 34 35 58) / <alpha-value>)',
        },
        ink: {
          DEFAULT: 'rgb(var(--color-text-rgb, 236 236 245) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted-rgb, 152 155 179) / <alpha-value>)',
          subtle: 'rgb(var(--color-text-subtle-rgb, 118 121 155) / <alpha-value>)',
        },
        line: {
          DEFAULT: 'rgb(var(--color-border-rgb, 38 40 65) / <alpha-value>)',
          strong: 'rgb(var(--color-border-strong-rgb, 54 56 90) / <alpha-value>)',
        },
        brand: {
          DEFAULT: 'rgb(var(--color-brand-rgb, 99 102 241) / <alpha-value>)',
          hover: 'rgb(var(--color-brand-hover-rgb, 129 140 248) / <alpha-value>)',
          light: 'rgb(var(--color-brand-light-rgb, 30 31 74) / <alpha-value>)',
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
          DEFAULT: 'rgb(var(--color-accent-blue-rgb, 99 102 241) / <alpha-value>)',
          hover: 'rgb(var(--color-accent-blue-hover-rgb, 79 70 229) / <alpha-value>)',
          light: 'rgb(var(--color-accent-blue-light-rgb, 30 31 74) / <alpha-value>)',
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
          50: 'var(--color-accent-50, #f1f3f7)',
          100: 'var(--color-accent-100, #e2e5f0)',
          200: 'var(--color-accent-200, #c5c9db)',
          300: 'var(--color-accent-300, #989bb3)',
          400: 'var(--color-accent-400, #76799b)',
          500: 'var(--color-accent-500, #5a5e7a)',
          600: 'var(--color-accent-600, #383b50)',
          700: 'var(--color-accent-700, #252740)',
          800: 'var(--color-accent-800, #181923)',
          900: 'var(--color-accent-900, #0f101a)',
          950: 'var(--color-accent-950, #080910)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        card: '0 10px 26px -24px rgb(79 70 229 / 0.34), 0 1px 2px -1px rgb(15 16 26 / 0.18)',
        'card-hover': '0 18px 38px -28px rgb(79 70 229 / 0.42), 0 3px 10px -8px rgb(15 16 26 / 0.25)',
        'card-soft': '0 12px 28px -25px rgb(79 70 229 / 0.36), 0 1px 0 rgb(255 255 255 / 0.035) inset',
        'card-soft-hover': '0 18px 42px -30px rgb(79 70 229 / 0.46), 0 1px 0 rgb(255 255 255 / 0.045) inset',
      },
    },
  },
  plugins: [],
}
