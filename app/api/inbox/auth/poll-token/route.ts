import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

// Must match the client ID in device-code/route.ts
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "YOUR_CLIENT_ID_HERE";

export async function POST(request: NextRequest) {
  try {
    const { deviceCode } = await request.json();

    if (!deviceCode) {
      return NextResponse.json(
        { error: "Device code required" },
        { status: 400 }
      );
    }

    const response = await fetch(
      "https://github.com/login/oauth/access_token",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          device_code: deviceCode,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
      }
    );

    const data = await response.json();

    if (data.error) {
      if (data.error === "authorization_pending") {
        return NextResponse.json({ status: "pending" });
      }
      if (data.error === "slow_down") {
        return NextResponse.json({ status: "slow_down" });
      }
      if (data.error === "expired_token") {
        return NextResponse.json({ status: "expired" });
      }
      if (data.error === "access_denied") {
        return NextResponse.json({ status: "denied" });
      }

      console.error("GitHub token poll error:", data.error);
      return NextResponse.json(
        { error: data.error_description || data.error },
        { status: 400 }
      );
    }

    const accessToken = data.access_token;

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!userResponse.ok) {
      return NextResponse.json(
        { error: "Failed to get user info" },
        { status: 500 }
      );
    }

    const githubUser = await userResponse.json();

    const cookieStore = await cookies();

    cookieStore.set("github_token", accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });

    cookieStore.set("github_username", githubUser.login, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    });

    return NextResponse.json({
      status: "success",
      username: githubUser.login,
    });
  } catch (error) {
    console.error("Token poll error:", error);
    return NextResponse.json(
      { error: "Failed to complete authentication" },
      { status: 500 }
    );
  }
}
