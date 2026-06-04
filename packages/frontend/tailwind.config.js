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
          DEFAULT: 'var(--color-bg, #0d2818)',
        },
        surface: {
          DEFAULT: 'var(--color-surface, #1a2e1f)',
          muted: 'var(--color-surface-muted, #122a1c)',
          elevated: 'var(--color-surface-elevated, #243d2a)',
        },
        ink: {
          DEFAULT: 'var(--color-text, #f5f5f5)',
          muted: 'var(--color-text-muted, #94a3b8)',
          subtle: 'var(--color-text-subtle, #9ca3af)',
        },
        line: {
          DEFAULT: 'var(--color-border, #2d4a35)',
          strong: 'var(--color-border-strong, #3d5c47)',
        },
        brand: {
          DEFAULT: 'var(--color-brand, #4f46e5)',
          hover: 'var(--color-brand-hover, #4338ca)',
          light: 'var(--color-brand-light, #1e1b4b)',
          foreground: '#ffffff',
        },
        'accent-orange': {
          DEFAULT: 'var(--color-accent-orange, #f97316)',
          hover: 'var(--color-accent-orange-hover, #ea580c)',
          light: 'var(--color-accent-orange-light, #431407)',
        },
        'accent-blue': {
          DEFAULT: 'var(--color-accent-blue, #2563eb)',
          hover: 'var(--color-accent-blue-hover, #1d4ed8)',
          light: 'var(--color-accent-blue-light, #1e3a5f)',
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
          50: 'var(--color-accent-50, #f0fdf4)',
          100: 'var(--color-accent-100, #dcfce7)',
          200: 'var(--color-accent-200, #bbf7d0)',
          300: 'var(--color-accent-300, #86efac)',
          400: 'var(--color-accent-400, #4ade80)',
          500: 'var(--color-accent-500, #22c55e)',
          600: 'var(--color-accent-600, #16a34a)',
          700: 'var(--color-accent-700, #15803d)',
          800: 'var(--color-accent-800, #166534)',
          900: 'var(--color-accent-900, #14532d)',
          950: 'var(--color-accent-950, #052e16)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.35), 0 1px 2px -1px rgb(0 0 0 / 0.25)',
        'card-hover': '0 8px 24px 0 rgb(0 0 0 / 0.45)',
      },
    },
  },
  plugins: [],
}
