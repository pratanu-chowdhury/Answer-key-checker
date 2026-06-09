# AnswerLens

AI-powered mock-paper grading tool for MK Actuarial. Powered by Claude and Anthropic's Vision API.

## Features

- 📄 Upload answer keys and student sheets (PDF or DOCX)
- 🤖 AI-powered grading analysis with Claude
- 📊 Real-time coverage visualization
- 🎚️ Adjustable marking threshold
- 📥 Download HTML reports

## Quick Start

### Prerequisites

- Node.js 16+ and npm
- Anthropic API key ([get one here](https://console.anthropic.com))

### Installation

1. Clone the repo
```bash
git clone https://github.com/pratanu-chowdhury/Answer-key-checker.git
cd Answer-key-checker
```

2. Install dependencies
```bash
npm install
```

3. Set up environment variables
```bash
cp .env.example .env
```

Then edit `.env` and add your Anthropic API key:
```
REACT_APP_ANTHROPIC_API_KEY=sk-ant-...
```

### Run locally

```bash
npm start
```

Opens at `http://localhost:3000`

### Build for production

```bash
npm run build
```

## How It Works

1. **Upload** your answer key (PDF/DOCX)
2. **Upload** the student's answer sheet (PDF/DOCX)
3. **Adjust** the coverage threshold (default: 40%)
4. **Click** "Start grading"
5. **Download** the HTML report

The AI examines each question, compares student answers against the key, and produces:
- Coverage percentage (0-100)
- Marks awarded based on threshold
- Examiner comments
- Overall summary

## Deployment

### Option A: Vercel (Recommended)

```bash
npm install -g vercel
vercel
```

### Option B: GitHub Pages

```bash
npm run build
npm install -g gh-pages
npm run deploy
```

(Add to `package.json`: `"homepage": "https://pratanu-chowdhury.github.io/Answer-key-checker"`)

### Option C: Netlify

Connect your GitHub repo to [Netlify](https://netlify.com) and enable automatic deploys.

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `REACT_APP_ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |

> Never commit `.env` to version control!

## File Format

### Supported Formats
- ✅ PDF
- ✅ DOCX (Microsoft Word)

### Document Structure
Both documents should have clear question numbering (e.g., Q1, Q1(i), Q2(a)) for accurate detection.

## API Usage

Each grading uses approximately:
- 2-5 API calls to Claude Sonnet 4
- ~10,000-20,000 tokens (varies with document length)

Check your [Anthropic billing dashboard](https://console.anthropic.com/account/billing/overview) for usage.

## Limitations

- Max file size: 20MB per document
- Complex layouts may require manual verification
- AI estimates should be verified for borderline scripts

## Contributing

Pull requests welcome! For major changes, open an issue first.

## License

MIT

## Support

- 📧 Email: [your-email]
- 🐛 Issues: [GitHub Issues](https://github.com/pratanu-chowdhury/Answer-key-checker/issues)
- 📖 Docs: See this README

---

**Note:** Coverage estimates are AI-generated. Always verify borderline scripts manually.
