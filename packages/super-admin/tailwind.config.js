/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        canvas: 'rgb(var(--color-bg-rgb) / <alpha-value>)',
        surface: 'rgb(var(--color-surface-rgb) / <alpha-value>)',
        'surface-muted': 'rgb(var(--color-surface-muted-rgb) / <alpha-value>)',
        'surface-elevated': 'rgb(var(--color-surface-elevated-rgb) / <alpha-value>)',
        ink: 'rgb(var(--color-text-rgb) / <alpha-value>)',
        'ink-muted': 'rgb(var(--color-text-muted-rgb) / <alpha-value>)',
        'ink-subtle': 'rgb(var(--color-text-subtle-rgb) / <alpha-value>)',
        line: 'rgb(var(--color-border-rgb) / <alpha-value>)',
        'line-strong': 'rgb(var(--color-border-strong-rgb) / <alpha-value>)',
        brand: {
          DEFAULT: 'rgb(var(--color-brand-rgb) / <alpha-value>)',
          hover: 'rgb(var(--color-brand-hover-rgb) / <alpha-value>)',
          light: 'rgb(var(--color-brand-light-rgb) / <alpha-value>)',
        },
      },
      boxShadow: {
        card: '0 1px 3px 0 rgb(0 0 0 / 0.35), 0 1px 2px -1px rgb(0 0 0 / 0.2)',
        'card-hover': '0 4px 12px rgb(0 0 0 / 0.4)',
        'card-soft': '0 1px 2px rgb(0 0 0 / 0.25)',
        'card-soft-hover': '0 4px 10px rgb(0 0 0 / 0.35)',
      },
    },
  },
  plugins: [],
}
