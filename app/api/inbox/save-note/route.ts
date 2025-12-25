import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST(request: NextRequest) {
  try {
    const { content, timezone } = await request.json();

    if (!content || typeof content !== "string" || !content.trim()) {
      return NextResponse.json(
        { error: "No content provided" },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const githubToken = cookieStore.get("github_token")?.value;
    const githubUsername = cookieStore.get("github_username")?.value;
    const githubRepo = cookieStore.get("github_repo")?.value;
    const inboxPath = cookieStore.get("inbox_path")?.value || "!inbox";

    if (!githubToken || !githubUsername) {
      return NextResponse.json(
        { error: "GitHub not connected", code: "GITHUB_NOT_CONNECTED" },
        { status: 400 }
      );
    }

    if (!githubRepo) {
      return NextResponse.json(
        { error: "No repository selected. Please select a repository in settings.", code: "NO_REPO_SELECTED" },
        { status: 400 }
      );
    }

    const now = new Date();
    const userTimezone = timezone || "UTC";
    let dateStr: string;
    let timeStr: string;
    let displayTimestamp: string;

    try {
      const formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: userTimezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      });

      const parts = formatter.formatToParts(now);
      const getPart = (type: string) => parts.find(p => p.type === type)?.value || "";

      dateStr = `${getPart("year")}${getPart("month")}${getPart("day")}`;
      timeStr = `${getPart("hour")}${getPart("minute")}`;
      displayTimestamp = `${getPart("year")}-${getPart("month")}-${getPart("day")} ${getPart("hour")}:${getPart("minute")}`;
    } catch {
      dateStr = now.toISOString().slice(0, 10).replace(/-/g, "");
      timeStr = now.toISOString().slice(11, 16).replace(":", "");
      displayTimestamp = now.toISOString().slice(0, 16).replace("T", " ");
    }

    const filename = `${dateStr}-${timeStr}-note.md`;
    const filepath = `${inboxPath}/${filename}`;

    const noteContent = `${content.trim()}

---
*Captured via Brain Inbox - ${displayTimestamp}*
`;

    const userCheckResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!userCheckResponse.ok) {
      const cookieStore2 = await cookies();
      cookieStore2.delete("github_token");
      cookieStore2.delete("github_username");
      cookieStore2.delete("github_repo");
      return NextResponse.json(
        { error: "GitHub session expired. Please reconnect.", code: "TOKEN_EXPIRED" },
        { status: 401 }
      );
    }

    const currentUser = await userCheckResponse.json();

    let repoOwner: string;
    let repoName: string;

    if (githubRepo.includes('/')) {
      [repoOwner, repoName] = githubRepo.split('/');
    } else {
      repoOwner = currentUser.login;
      repoName = githubRepo;
    }

    const apiUrl = `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filepath}`;

    const repoCheckResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!repoCheckResponse.ok) {
      if (repoCheckResponse.status === 404) {
        return NextResponse.json(
          { error: `Repository "${repoOwner}/${repoName}" not found. Please select a different repository.`, code: "REPO_NOT_FOUND" },
          { status: 404 }
        );
      }
      const repoError = await repoCheckResponse.json().catch(() => ({}));
      return NextResponse.json(
        { error: `Cannot access repo: ${repoError.message || repoCheckResponse.status}` },
        { status: 403 }
      );
    }

    const inboxCheckResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${inboxPath}`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!inboxCheckResponse.ok && inboxCheckResponse.status === 404) {
      const gitkeepResponse = await fetch(
        `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${inboxPath}/.gitkeep`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${githubToken}`,
            "Content-Type": "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
          body: JSON.stringify({
            message: "Create inbox folder",
            content: Buffer.from("").toString("base64"),
          }),
        }
      );

      if (!gitkeepResponse.ok) {
        return NextResponse.json(
          { error: `Could not create ${inboxPath} folder in repository` },
          { status: 500 }
        );
      }
    }

    const createFileResponse = await fetch(apiUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({
        message: `Inbox capture: ${now.toISOString().slice(0, 16).replace("T", " ")}`,
        content: Buffer.from(noteContent).toString("base64"),
      }),
    });

    if (!createFileResponse.ok) {
      let errorData;
      try {
        errorData = await createFileResponse.json();
      } catch {
        errorData = { message: "Could not parse error response" };
      }

      if (createFileResponse.status === 422) {
        const unixTimestamp = Math.floor(Date.now() / 1000);
        const newFilename = `${dateStr}-${timeStr}-voice-${unixTimestamp}.md`;
        const newFilepath = `${inboxPath}/${newFilename}`;

        const retryResponse = await fetch(
          `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${newFilepath}`,
          {
            method: "PUT",
            headers: {
              Authorization: `Bearer ${githubToken}`,
              "Content-Type": "application/json",
              "X-GitHub-Api-Version": "2022-11-28",
            },
            body: JSON.stringify({
              message: `Inbox capture: ${now.toISOString().slice(0, 16).replace("T", " ")}`,
              content: Buffer.from(noteContent).toString("base64"),
            }),
          }
        );

        if (!retryResponse.ok) {
          return NextResponse.json(
            { error: "Failed to save to GitHub" },
            { status: 500 }
          );
        }

        return NextResponse.json({
          success: true,
          path: newFilepath,
        });
      }

      const errorMsg = errorData?.message || "Unknown GitHub error";
      return NextResponse.json(
        { error: `GitHub: ${errorMsg}` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      path: filepath,
    });
  } catch (error) {
    console.error("[save-note] Unexpected error:", error);
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: `Save failed: ${errorMsg}` },
      { status: 500 }
    );
  }
}
