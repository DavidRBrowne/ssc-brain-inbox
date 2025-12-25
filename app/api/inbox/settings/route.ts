import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = await cookies();

  const githubRepo = cookieStore.get("github_repo")?.value || "";
  const inboxPath = cookieStore.get("inbox_path")?.value || "!inbox";

  return NextResponse.json({
    repo: githubRepo,
    inboxPath,
  });
}

export async function POST(request: NextRequest) {
  try {
    const { repo, inboxPath, clearRepo } = await request.json();

    const cookieStore = await cookies();

    if (clearRepo === true) {
      cookieStore.delete("github_repo");
      return NextResponse.json({ success: true, cleared: true });
    }

    if (repo) {
      cookieStore.set("github_repo", repo, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
      });
    }

    if (inboxPath) {
      cookieStore.set("inbox_path", inboxPath, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 365,
        path: "/",
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Settings update error:", error);
    return NextResponse.json(
      { error: "Failed to update settings" },
      { status: 500 }
    );
  }
}
