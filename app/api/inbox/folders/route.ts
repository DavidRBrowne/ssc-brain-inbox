import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();
  const githubToken = cookieStore.get("github_token")?.value;
  const githubUsername = cookieStore.get("github_username")?.value;

  if (!githubToken || !githubUsername) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 }
    );
  }

  const repo = request.nextUrl.searchParams.get("repo");

  if (!repo) {
    return NextResponse.json(
      { error: "Repository name required" },
      { status: 400 }
    );
  }

  try {
    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!userResponse.ok) {
      return NextResponse.json(
        { error: "Token validation failed" },
        { status: 401 }
      );
    }

    const user = await userResponse.json();

    let repoOwner: string;
    let repoName: string;

    if (repo.includes('/')) {
      [repoOwner, repoName] = repo.split('/');
    } else {
      repoOwner = user.login;
      repoName = repo;
    }

    const response = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/contents`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!response.ok) {
      if (response.status === 404) {
        return NextResponse.json(
          { error: "Repository not found" },
          { status: 404 }
        );
      }
      return NextResponse.json(
        { error: "Failed to fetch repository contents" },
        { status: 500 }
      );
    }

    const contents = await response.json();

    const folders = contents
      .filter((item: { type: string; name: string }) => item.type === "dir")
      .map((item: { name: string; path: string }) => ({
        name: item.name,
        path: item.path,
      }))
      .sort((a: { name: string }, b: { name: string }) => {
        if (a.name === "!inbox") return -1;
        if (b.name === "!inbox") return 1;
        if (a.name.startsWith("!") && !b.name.startsWith("!")) return -1;
        if (!a.name.startsWith("!") && b.name.startsWith("!")) return 1;
        return a.name.localeCompare(b.name);
      });

    return NextResponse.json({ folders });
  } catch (error) {
    console.error("Fetch folders error:", error);
    return NextResponse.json(
      { error: "Failed to fetch folders" },
      { status: 500 }
    );
  }
}
