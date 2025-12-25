import type { Metadata, Viewport } from "next";

export const metadata: Metadata = {
  title: "Brain Chat",
  description: "Chat with your brain",
  manifest: "/chat-manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "Brain Chat",
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

export default function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Use fixed positioning to overlay the parent layout completely
  // This prevents the double-header issue from /i/layout.tsx
  return (
    <div className="fixed inset-0 bg-white z-50 flex flex-col">
      {children}
    </div>
  );
}
