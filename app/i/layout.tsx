import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { Settings, MessageSquare } from "lucide-react";

export const metadata: Metadata = {
  title: "Brain Inbox",
  description: "Capture voice notes to your brain",
  manifest: "/inbox-manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Brain Inbox",
  },
  icons: {
    icon: "/favicon.png",
    apple: "/brain-icon-192.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#1e3a5f",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function InboxLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <Link
          href="/"
          className="flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900 transition-colors"
        >
          <span>←</span>
          <span className="hidden sm:inline">Back to Brain</span>
        </Link>

        {/* Center - Chat with Brain */}
        <Link
          href="/i/chat"
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 text-gray-700 rounded-lg font-medium hover:bg-gray-200 transition-colors text-sm"
          title="Experimental - requires Anthropic API key"
        >
          <MessageSquare className="w-4 h-4" />
          <span className="sm:hidden">Chat</span>
          <span className="hidden sm:inline">Chat with Brain</span>
          <span className="hidden sm:inline text-xs bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded font-medium">BETA</span>
        </Link>

        <Link
          href="/i/settings"
          className="p-2 text-gray-500 hover:text-gray-900 transition-colors"
        >
          <Settings className="h-5 w-5" />
        </Link>
      </header>

      {/* Main content */}
      <main className="flex-1 flex flex-col">
        {children}
      </main>

    </div>
  );
}
