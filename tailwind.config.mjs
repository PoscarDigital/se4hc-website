/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      colors: {
        primary: '#1e3a8a',
        secondary: '#3b82f6',
        accent: '#fbbf24',
        'light-blue': '#93c5fd',
        background: '#f8fafc',
        text: '#333333',
      },
      fontFamily: {
        khmer: ['Battambang', 'Noto Sans Khmer', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
