/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // ── Brand greens ─────────────────────────────────
        brand: {
          DEFAULT: '#009E4D',
          dark:    '#007A3C',
          light:   '#00C25E',
          muted:   '#E6F7EE',  // very light green tint — subtle fills
          faint:   '#F0FAF4',  // near-white green tint — hover/active bg
        },
        // ── Surface / background layers ───────────────────
        // Light theme: white → light grey hierarchy
        surface: {
          bg:     '#F4F6F5',   // page background — light grey with faint green tint
          card:   '#FFFFFF',   // card / panel background — pure white
          raised: '#F0F2F1',   // elevated elements, inputs — slightly off-white
          border: '#D6DED8',   // dividers and borders — cool grey-green
          hover:  '#E8F2EC',   // hover states — light green tint
        },
        // ── Text hierarchy ────────────────────────────────
        // Dark text on light backgrounds
        text: {
          primary:   '#0F1F14',  // near-black with green tint
          secondary: '#3D6B4A',  // mid-green for secondary labels
          muted:     '#7A9E84',  // muted green-grey for placeholders/hints
          inverse:   '#FFFFFF',  // white text on brand-green backgrounds
          code:      '#006E35',  // dark green for monospace code values
        },
        // ── Semantic states ───────────────────────────────
        // Slightly deeper shades — better contrast on white backgrounds
        anomaly:  '#DC2626',
        warning:  '#D97706',
        normal:   '#16A34A',
        info:     '#2563EB',
        pending:  '#D97706',
      },
      fontFamily: {
        // Monospace for data values, OBIS codes, JSON
        mono: ['JetBrains Mono', 'Fira Code', 'Consolas', 'monospace'],
        // UI labels and navigation
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      fontSize: {
        '2xs': ['0.625rem', { lineHeight: '0.875rem' }],
      },
      spacing: {
        '0.75': '0.1875rem',
        '13':   '3.25rem',
        '15':   '3.75rem',
        '18':   '4.5rem',
      },
      borderRadius: {
        sm: '0.1875rem',
      },
      boxShadow: {
        card:   '0 1px 3px rgba(0,0,0,0.08), 0 0 0 1px rgba(214,222,216,0.8)',
        glow:   '0 0 12px rgba(0,158,77,0.20)',
        inner:  'inset 0 1px 0 rgba(255,255,255,0.8)',
      },
      animation: {
        'pulse-slow': 'pulse 2.5s cubic-bezier(0.4,0,0.6,1) infinite',
        'fade-in':    'fadeIn 0.2s ease-out',
        'slide-in':   'slideIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0' },
          '100%': { opacity: '1' },
        },
        slideIn: {
          '0%':   { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
    },
  },
  plugins: [],
}
