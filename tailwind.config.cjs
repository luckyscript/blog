/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./src/**/*.astro"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        body: ["Source Serif Pro", "Songti SC", "Noto Serif SC", "Georgia", "serif"],
        heading: ["Source Serif Pro", "Songti SC", "Georgia", "serif"],
        mono: ["JetBrains Mono", "Sarasa Mono SC", "Menlo", "monospace"],
        kai: ["CangEr", "Kaiti SC", "STKaiti", "serif"],
      },
      colors: {
        transparent: "transparent",
        current: "currentColor",
        ink: {
          DEFAULT: "rgb(var(--color-ink) / <alpha-value>)",
          soft: "rgb(var(--color-ink-soft) / <alpha-value>)",
          muted: "rgb(var(--color-ink-muted) / <alpha-value>)",
        },
        stamp: "rgb(var(--color-stamp) / <alpha-value>)",
        text: {
          body: "rgb(var(--color-text-body) / <alpha-value>)",
          bold: "rgb(var(--color-text-bold) / <alpha-value>)",
          heading: "rgb(var(--color-text-heading) / <alpha-value>)",
          muted: "rgb(var(--color-text-muted) / <alpha-value>)",
          code: "rgb(var(--color-text-code) / <alpha-value>)",
          link: "rgb(var(--color-text-link) / <alpha-value>)",
          selection: "rgb(var(--color-text-selection) / <alpha-value>)",
        },
        bg: {
          body: "rgb(var(--color-bg-body) / <alpha-value>)",
          panel: "rgb(var(--color-bg-panel) / <alpha-value>)",
          code: "rgb(var(--color-bg-code) / <alpha-value>)",
          selection: "rgb(var(--color-bg-selection) / <alpha-value>)",
        },
        border: {
          DEFAULT: "rgb(var(--color-border) / <alpha-value>)",
          soft: "rgb(var(--color-border-soft) / <alpha-value>)",
          code: "rgb(var(--color-border-code) / <alpha-value>)",
        },
      },
      typography: () => ({
        DEFAULT: {
          css: {
            a: {
              "text-decoration": "none",
              color: "rgb(var(--color-stamp))",
              "background-image": "none",
              "&:hover": {
                color: "rgb(var(--color-stamp) / 0.8)",
              },
            },
            "img": {
              "border-radius": "4px",
              "max-width": "60%",
              border: "1px solid rgb(var(--color-border) / 0.3)",
            },
            "h1, h2, h3, h4, h5": {
              "font-family": "Source Serif Pro, Songti SC, Georgia, serif",
              color: "rgb(var(--color-text-heading))",
              "font-weight": "600",
            },
            "code::before": {
              content: "none",
            },
            "code::after": {
              content: "none",
            },
            blockquote: {
              border: "none",
              position: "relative",
              "font-size": "1.0625em",
              "padding-top": "1.5rem",
              "padding-bottom": "0.5rem",
              "padding-left": "1.5rem",
              "padding-right": "1.5rem",
              "border-left": "2px solid rgb(var(--color-stamp) / 0.5)",
              "font-style": "italic",
              color: "rgb(var(--color-ink-soft))",
            },
            "blockquote::before": {
              content: "none",
            },
            "blockquote::after": {
              content: "",
            },
            "blockquote p:first-of-type::before": {
              content: "",
            },
            "blockquote p:last-of-type::after": {
              content: "",
            },
            hr: {
              "border-color": "rgb(var(--color-border-soft))",
            },
          },
        },
        inkrain: {
          css: {
            "--tw-prose-body": "rgb(var(--color-text-body))",
            "--tw-prose-headings": "rgb(var(--color-text-heading))",
            "--tw-prose-links": "rgb(var(--color-stamp))",
            "--tw-prose-bold": "rgb(var(--color-text-bold))",
            "--tw-prose-counters": "rgb(var(--color-ink-muted))",
            "--tw-prose-bullets": "rgb(var(--color-ink-muted))",
            "--tw-prose-hr": "rgb(var(--color-border-soft))",
            "--tw-prose-quotes": "rgb(var(--color-ink-soft))",
            "--tw-prose-quote-borders": "rgb(var(--color-stamp) / 0.5)",
            "--tw-prose-code": "rgb(var(--color-text-code))",
            "--tw-prose-pre-code": "rgb(var(--color-text-code))",
            "--tw-prose-pre-bg": "rgb(var(--color-bg-code))",
            "--tw-prose-th-borders": "rgb(var(--color-border-soft))",
            "--tw-prose-td-borders": "rgb(var(--color-border-soft))",
          },
        },
      }),
    },
  },
  plugins: [require("@tailwindcss/typography")],
};
