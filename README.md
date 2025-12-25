# Brain Inbox & Chat PWA

A standalone Progressive Web App for capturing voice notes and chatting with your brain repository files.

**Features:**
- **Voice Inbox**: Record voice notes that get saved directly to your GitHub brain repository
- **Brain Chat**: Chat with AI (Claude, GPT, or Gemini) with context from your brain files
- **PWA Support**: Install on your phone for quick access

## Quick Start

### 1. Create a GitHub OAuth App

You need your own GitHub OAuth App to enable the GitHub connection.

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **OAuth Apps** > **New OAuth App**
3. Fill in:
   - **Application name**: `Brain Inbox` (or whatever you like)
   - **Homepage URL**: Your Vercel URL (e.g., `https://your-app.vercel.app`)
   - **Authorization callback URL**: Same as homepage URL
4. Click **Register application**
5. Copy the **Client ID** (you'll need this)

> **Note**: You do NOT need a Client Secret. This app uses GitHub's Device Flow which doesn't require secrets.

### 2. Deploy to Vercel

The easiest way to deploy:

1. Push this code to your own GitHub repository
2. Go to [vercel.com](https://vercel.com) and sign in
3. Click **Add New** > **Project**
4. Import your GitHub repository
5. In **Environment Variables**, add:
   - `GITHUB_CLIENT_ID` = Your GitHub OAuth App Client ID
6. Click **Deploy**

That's it! Your app will be live at `https://your-project.vercel.app`

### 3. Install as PWA (Optional)

On your phone:
- **iOS**: Open in Safari > Share > Add to Home Screen
- **Android**: Open in Chrome > Menu > Add to Home Screen

## Local Development

```bash
# Install dependencies
npm install

# Create .env.local with your GitHub Client ID
echo "GITHUB_CLIENT_ID=your_client_id_here" > .env.local

# Run development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## How It Works

### Voice Inbox (`/i`)

1. Connect your GitHub account (one-time setup)
2. Select which repository to save notes to
3. Choose the inbox folder (defaults to `!inbox`)
4. Record voice notes or type text
5. Notes are saved as markdown files to your GitHub repo

### Brain Chat (`/i/chat`)

1. Add your AI API key (Claude, GPT, or Gemini)
2. Browse and load files from your brain repository
3. Chat with AI using your files as context
4. AI can use the `load_file` tool to read additional files

## Project Structure

```
/
├── app/
│   ├── api/inbox/          # API routes for GitHub integration
│   ├── i/                   # Inbox page
│   │   ├── chat/           # Chat page
│   │   └── settings/       # Settings page
│   ├── layout.tsx          # Root layout
│   └── page.tsx            # Home page
├── lib/
│   ├── brain-chat.ts       # Core chat library
│   ├── format-markdown.ts  # Markdown formatting
│   └── providers/          # AI provider implementations
├── public/                  # PWA icons and manifests
└── package.json
```

## Customization

### Change the Inbox Folder

The default inbox folder is `!inbox`. You can change this in Settings after connecting.

### Use Your Own Icons

Replace the files in `/public/`:
- `brain-icon-192.png` (192x192)
- `brain-icon-512.png` (512x512)
- `favicon.png`

### Modify AI System Prompts

Edit `lib/brain-chat.ts` to customize how the AI behaves when chatting.

## Troubleshooting

### "GitHub Client ID not configured"

Make sure you've set the `GITHUB_CLIENT_ID` environment variable in Vercel (or `.env.local` for local dev).

### Can't connect to GitHub

1. Check your OAuth App settings in GitHub
2. Make sure the callback URL matches your deployment URL
3. Try disconnecting and reconnecting in Settings

### Voice recording not working

- Make sure you've granted microphone permissions
- Works best in Chrome or Safari
- Some browsers require HTTPS (use Vercel deployment, not localhost for full testing)

### Chat not responding

- Check that your API key is valid
- Claude: Get key from [console.anthropic.com](https://console.anthropic.com)
- OpenAI: Get key from [platform.openai.com](https://platform.openai.com)
- Gemini: Get key from [aistudio.google.com](https://aistudio.google.com)

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GITHUB_CLIENT_ID` | Yes | Your GitHub OAuth App Client ID |

## Tech Stack

- **Next.js 15** - React framework
- **Tailwind CSS 4** - Styling
- **GitHub API** - Repository access
- **Web Speech API** - Voice recording

## License

MIT - Feel free to modify and use however you like.
