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
          DEFAULT: 'var(--color-bg, #0f172a)',
        },
        surface: {
          DEFAULT: 'var(--color-surface, #1e293b)',
          muted: 'var(--color-surface-muted, #1a1a1a)',
          elevated: 'var(--color-surface-elevated, #334155)',
        },
        ink: {
          DEFAULT: 'var(--color-text, #f5f5f5)',
          muted: 'var(--color-text-muted, #94a3b8)',
          subtle: 'var(--color-text-subtle, #9ca3af)',
        },
        line: {
          DEFAULT: 'var(--color-border, #334155)',
          strong: 'var(--color-border-strong, #475569)',
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
          DEFAULT: 'var(--color-accent-blue, #4f46e5)',
          hover: 'var(--color-accent-blue-hover, #4338ca)',
          light: 'var(--color-accent-blue-light, #1e1b4b)',
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
