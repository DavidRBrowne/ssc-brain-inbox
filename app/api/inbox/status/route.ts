import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function GET(request: NextRequest) {
  const cookieStore = await cookies();

  const githubToken = cookieStore.get("github_token")?.value;
  const githubUsername = cookieStore.get("github_username")?.value;
  const githubRepo = cookieStore.get("github_repo")?.value;
  const inboxPath = cookieStore.get("inbox_path")?.value || "!inbox";

  const debug = request.nextUrl.searchParams.get("debug") === "true";

  const response: Record<string, unknown> = {
    githubConnected: !!githubToken,
    githubUsername: githubUsername || null,
    githubRepo: githubRepo || null,
    inboxPath,
  };

  if (debug && githubToken) {
    try {
      const userResponse = await fetch("https://api.github.com/user", {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      });

      if (userResponse.ok) {
        const user = await userResponse.json();
        response.tokenValid = true;
        response.tokenUser = user.login;
        response.tokenScopes = userResponse.headers.get("x-oauth-scopes");

        if (user.login !== githubUsername) {
          response.usernameMismatch = true;
          response.storedUsername = githubUsername;
          response.actualUsername = user.login;
        }
      } else {
        response.tokenValid = false;
        response.tokenError = userResponse.status;
      }

      if (githubRepo) {
        const repoOwner = response.tokenValid ? response.tokenUser : githubUsername;
        const repoResponse = await fetch(
          `https://api.github.com/repos/${repoOwner}/${githubRepo}`,
          {
            headers: {
              Authorization: `Bearer ${githubToken}`,
              "X-GitHub-Api-Version": "2022-11-28",
            },
          }
        );

        response.repoAccessible = repoResponse.ok;
        if (!repoResponse.ok) {
          response.repoError = repoResponse.status;
        }
      }
    } catch (error) {
      response.debugError = error instanceof Error ? error.message : "Unknown error";
    }
  }

  return NextResponse.json(response);
}
