import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET() {
  const cookieStore = await cookies();
  const githubToken = cookieStore.get("github_token")?.value;

  if (!githubToken) {
    return NextResponse.json(
      { error: "Not authenticated" },
      { status: 401 }
    );
  }

  try {
    const response = await fetch(
      "https://api.github.com/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator&visibility=all",
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!response.ok) {
      return NextResponse.json(
        { error: "Failed to fetch repos" },
        { status: 500 }
      );
    }

    const repos = await response.json();

    const repoList = repos.map((repo: { name: string; full_name: string; private: boolean }) => ({
      name: repo.name,
      fullName: repo.full_name,
      private: repo.private,
    }));

    return NextResponse.json({ repos: repoList });
  } catch (error) {
    console.error("Fetch repos error:", error);
    return NextResponse.json(
      { error: "Failed to fetch repos" },
      { status: 500 }
    );
  }
}
