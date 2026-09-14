# Contributing to LuminaFeed

Thank you for your interest in contributing to **LuminaFeed**! We welcome community contributions to improve real-time event photo sharing for everyone.

---

## 🌟 How Can You Help?

- 🐛 **Report Bugs**: Submit detailed issues with steps to reproduce, screenshots, and device information.
- 💡 **Suggest Features**: Propose UX improvements, new transitions, or storage integrations.
- 💻 **Submit Code**: Pick up an open issue or optimize existing client components.
- 📖 **Improve Documentation**: Enhance runbooks, guides, or deployment instructions.

---

## 🛠️ Development Setup

LuminaFeed is built with **Svelte 5** and **Vite 6** as a pure client-side SPA.

1. **Fork and Clone the Repo**:
   ```bash
   git clone https://github.com/deidi/lumina-feed.git
   cd lumina-feed
   ```

2. **Install Client Dependencies**:
   ```bash
   cd client
   npm install
   ```

3. **Start Local Development Server**:
   ```bash
   npm run dev
   ```
   Open `http://localhost:5173/` in your browser.

4. **Verify Compiler Diagnostics & Production Build**:
   ```bash
   npx svelte-check --threshold warning
   npm run build
   ```

---

## 📋 Pull Request (PR) Process

1. Create a descriptive feature branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```
2. Follow existing code formatting conventions (Vanilla CSS design tokens, Svelte 5 Runes).
3. Ensure no compiler warnings or build failures are introduced.
4. Open a clear Pull Request against `main` explaining:
   - What problem this solves.
   - Screenshots or video recordings for UI changes.
   - Any testing steps performed.

---

## 📜 Code of Conduct

Please note that this project is released with a [Code of Conduct](CODE_OF_CONDUCT.md). By participating, you agree to abide by its terms.
