import { NextResponse } from "next/server";

// ============================================================================
// IMPORTANT: Replace this with your own GitHub OAuth App Client ID
// Create your OAuth App at: https://github.com/settings/developers
// Set the callback URL to: http://localhost:3000 (for development)
// ============================================================================
const GITHUB_CLIENT_ID = process.env.GITHUB_CLIENT_ID || "YOUR_CLIENT_ID_HERE";

export async function POST() {
  if (GITHUB_CLIENT_ID === "YOUR_CLIENT_ID_HERE") {
    return NextResponse.json(
      { error: "GitHub Client ID not configured. Please set GITHUB_CLIENT_ID in your environment variables." },
      { status: 500 }
    );
  }

  try {
    const response = await fetch(
      "https://github.com/login/device/code",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          scope: "repo",
        }),
      }
    );

    if (!response.ok) {
      console.error("GitHub device code error:", response.status);
      return NextResponse.json(
        { error: "Failed to get device code" },
        { status: 500 }
      );
    }

    const data = await response.json();

    return NextResponse.json({
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval,
    });
  } catch (error) {
    console.error("Device code request error:", error);
    return NextResponse.json(
      { error: "Failed to initiate GitHub connection" },
      { status: 500 }
    );
  }
}
