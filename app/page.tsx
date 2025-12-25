import Link from "next/link";

export default function HomePage() {
  return (
    <div className="min-h-screen bg-white flex flex-col items-center justify-center p-4">
      <h1 className="text-3xl font-bold text-gray-900 mb-2">Brain Tools</h1>
      <p className="text-gray-600 mb-8">Your personal AI-powered productivity suite</p>

      <div className="flex flex-col gap-4 w-full max-w-xs">
        <Link
          href="/i"
          className="flex items-center justify-center gap-2 px-6 py-4 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors"
        >
          Voice Inbox
        </Link>
        <Link
          href="/i/chat"
          className="flex items-center justify-center gap-2 px-6 py-4 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Chat with Brain
        </Link>
      </div>
    </div>
  );
}
