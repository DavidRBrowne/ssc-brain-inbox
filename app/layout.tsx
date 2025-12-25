import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brain Inbox & Chat",
  description: "Capture voice notes to your brain and chat with your files",
  icons: {
    icon: "/favicon.png",
    apple: "/brain-icon-192.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="font-sans antialiased bg-white text-gray-700">
        {children}
      </body>
    </html>
  );
}
