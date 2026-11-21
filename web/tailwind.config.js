/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', 'system-ui', 'sans-serif'],
        body: ['Geist', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace'],
        'headline-sm': ['"Plus Jakarta Sans"'],
        'headline-md': ['"Plus Jakarta Sans"'],
        'headline-lg': ['"Plus Jakarta Sans"'],
        'label-md': ['Geist'],
        'label-lg': ['Geist'],
        'label-mono': ['Geist'],
        'body-sm': ['Geist'],
        'body-md': ['Geist'],
        'body-lg': ['Geist'],
      },
      colors: {
        // MD3 Surface hierarchy
        'surface': '#111318',
        'surface-dim': '#111318',
        'surface-bright': '#37393f',
        'surface-tint': '#4edea3',
        'surface-variant': '#33353a',
        'surface-container-lowest': '#0c0e13',
        'surface-container-low': '#1a1b21',
        'surface-container': '#1e2025',
        'surface-container-high': '#282a2f',
        'surface-container-highest': '#33353a',
        'background': '#0c0e13',

        // MD3 Primary
        'primary': '#4edea3',
        'primary-container': '#10b981',
        'primary-fixed': '#6ffbbe',
        'primary-fixed-dim': '#4edea3',
        'on-primary': '#003824',
        'on-primary-container': '#00422b',
        'on-primary-fixed': '#002113',
        'on-primary-fixed-variant': '#005236',
        'inverse-primary': '#006c49',

        // MD3 Secondary
        'secondary': '#4fdbc8',
        'secondary-container': '#04b4a2',
        'secondary-fixed': '#71f8e4',
        'secondary-fixed-dim': '#4fdbc8',
        'on-secondary': '#003731',
        'on-secondary-container': '#003f38',
        'on-secondary-fixed': '#00201c',
        'on-secondary-fixed-variant': '#005048',

        // MD3 Tertiary
        'tertiary': '#ffb95f',
        'tertiary-container': '#e29100',
        'tertiary-fixed': '#ffddb8',
        'tertiary-fixed-dim': '#ffb95f',
        'on-tertiary': '#472a00',
        'on-tertiary-container': '#523200',
        'on-tertiary-fixed': '#2a1700',
        'on-tertiary-fixed-variant': '#653e00',

        // MD3 Error
        'error': '#ffb4ab',
        'error-container': '#93000a',
        'on-error': '#690005',
        'on-error-container': '#ffdad6',

        // MD3 Neutral / On-surface
        'on-surface': '#e2e2e9',
        'on-surface-variant': '#bbcabf',
        'on-background': '#e2e2e9',
        'inverse-surface': '#e2e2e9',
        'inverse-on-surface': '#2e3036',
        'outline': '#86948a',
        'outline-variant': '#3c4a42',

        // Legacy Home screen surface tokens
        'surface-base': '#0c0e13',
        'surface-lowest': '#0a0c10',
        'surface-card': '#141620',
        'surface-card-hover': '#1a1d2b',
        'surface-input': '#10121a',
        'surface-border': '#1e2235',

        // Legacy compat (for Home screen)
        'brand': {
          emerald: '#10b981',
          'emerald-hover': '#059669',
          'emerald-dark': '#064e3b',
          amber: '#f59e0b',
          'amber-hover': '#d97706',
        },
      },
      spacing: {
        'space-xs': '0.25rem',
        'space-sm': '0.5rem',
        'space-md': '0.75rem',
        'space-lg': '1rem',
        'space-xl': '1.5rem',
        'gutter': '0.75rem',
        'margin': '1rem',
      },
      boxShadow: {
        glow: '0 0 35px -8px rgba(16, 185, 129, 0.25)',
        'card-glow': '0 20px 40px -15px rgba(0, 0, 0, 0.7), 0 0 1px 1px rgba(255, 255, 255, 0.05)',
        'pill': '0 8px 32px -4px rgba(0, 0, 0, 0.6)',
      },
    },
  },
  plugins: [],
}
