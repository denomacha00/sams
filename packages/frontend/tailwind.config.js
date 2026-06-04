/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        surface: {
          DEFAULT: 'var(--color-surface, #ffffff)',
          muted: 'var(--color-surface-muted, #f6f6f6)',
          elevated: 'var(--color-surface-elevated, #ffffff)',
        },
        ink: {
          DEFAULT: 'var(--color-text, #1d1d1d)',
          muted: 'var(--color-text-muted, #64748b)',
          subtle: 'var(--color-text-subtle, #94a3b8)',
        },
        line: {
          DEFAULT: 'var(--color-border, #e2e8f0)',
          strong: 'var(--color-border-strong, #cbd5e1)',
        },
        brand: {
          DEFAULT: 'var(--color-brand, #4f46e5)',
          hover: 'var(--color-brand-hover, #4338ca)',
          light: 'var(--color-brand-light, #eef2ff)',
          foreground: '#ffffff',
        },
        // School branding support — override via CSS variables
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
        card: '0 1px 3px 0 rgb(0 0 0 / 0.06), 0 1px 2px -1px rgb(0 0 0 / 0.06)',
        'card-hover': '0 4px 12px 0 rgb(0 0 0 / 0.08)',
      },
    },
  },
  plugins: [],
}
