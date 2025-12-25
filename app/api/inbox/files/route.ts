import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";

interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'dir';
  children?: FileNode[];
}

const MAX_FILE_SIZE = 100 * 1024;

const EXCLUDED_PATTERNS = [
  /^\.git\//,
  /^node_modules\//,
  /^\.next\//,
  /^\.DS_Store$/,
  /\.png$/i,
  /\.jpg$/i,
  /\.jpeg$/i,
  /\.gif$/i,
  /\.svg$/i,
  /\.ico$/i,
  /\.pdf$/i,
  /\.zip$/i,
  /\.tar$/i,
  /\.gz$/i,
];

function shouldExclude(path: string): boolean {
  return EXCLUDED_PATTERNS.some(pattern => pattern.test(path));
}

export async function GET() {
  try {
    const cookieStore = await cookies();
    const githubToken = cookieStore.get("github_token")?.value;
    const githubRepo = cookieStore.get("github_repo")?.value;

    if (!githubToken || !githubRepo) {
      return NextResponse.json(
        { error: "GitHub not connected" },
        { status: 401 }
      );
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!userResponse.ok) {
      return NextResponse.json(
        { error: "GitHub session expired" },
        { status: 401 }
      );
    }

    const user = await userResponse.json();

    let repoOwner: string;
    let repoName: string;

    if (githubRepo.includes('/')) {
      [repoOwner, repoName] = githubRepo.split('/');
    } else {
      repoOwner = user.login;
      repoName = githubRepo;
    }

    const treeResponse = await fetch(
      `https://api.github.com/repos/${repoOwner}/${repoName}/git/trees/main?recursive=1`,
      {
        headers: {
          Authorization: `Bearer ${githubToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
      }
    );

    if (!treeResponse.ok) {
      const masterResponse = await fetch(
        `https://api.github.com/repos/${repoOwner}/${repoName}/git/trees/master?recursive=1`,
        {
          headers: {
            Authorization: `Bearer ${githubToken}`,
            "X-GitHub-Api-Version": "2022-11-28",
          },
        }
      );

      if (!masterResponse.ok) {
        return NextResponse.json(
          { error: "Could not fetch repository tree" },
          { status: 500 }
        );
      }

      const masterData = await masterResponse.json();
      return NextResponse.json({ tree: buildTree(masterData.tree) });
    }

    const treeData = await treeResponse.json();
    return NextResponse.json({ tree: buildTree(treeData.tree) });
  } catch (error) {
    console.error("[files] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch files" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { paths } = await request.json();

    if (!paths || !Array.isArray(paths) || paths.length === 0) {
      return NextResponse.json(
        { error: "No file paths provided" },
        { status: 400 }
      );
    }

    const cookieStore = await cookies();
    const githubToken = cookieStore.get("github_token")?.value;
    const githubRepo = cookieStore.get("github_repo")?.value;

    if (!githubToken || !githubRepo) {
      return NextResponse.json(
        { error: "GitHub not connected" },
        { status: 401 }
      );
    }

    const userResponse = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    });

    if (!userResponse.ok) {
      return NextResponse.json(
        { error: "GitHub session expired" },
        { status: 401 }
      );
    }

    const user = await userResponse.json();

    let repoOwner: string;
    let repoName: string;

    if (githubRepo.includes('/')) {
      [repoOwner, repoName] = githubRepo.split('/');
    } else {
      repoOwner = user.login;
      repoName = githubRepo;
    }

    const files = await Promise.all(
      paths.map(async (path: string) => {
        try {
          const response = await fetch(
            `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${encodeURIComponent(path)}`,
            {
              headers: {
                Authorization: `Bearer ${githubToken}`,
                "X-GitHub-Api-Version": "2022-11-28",
              },
            }
          );

          if (!response.ok) {
            return { path, content: `[Error loading file: ${response.status}]`, error: true };
          }

          const data = await response.json();

          if (data.size > MAX_FILE_SIZE) {
            return { path, content: `[File too large: ${Math.round(data.size / 1024)}KB, max ${MAX_FILE_SIZE / 1024}KB]`, error: true };
          }

          const content = Buffer.from(data.content, 'base64').toString('utf-8');
          return { path, content };
        } catch (err) {
          return { path, content: `[Error: ${err instanceof Error ? err.message : 'Unknown error'}]`, error: true };
        }
      })
    );

    return NextResponse.json({ files });
  } catch (error) {
    console.error("[files] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch file contents" },
      { status: 500 }
    );
  }
}

function buildTree(items: Array<{ path: string; type: string; size?: number }>): FileNode[] {
  const root: FileNode[] = [];
  const map = new Map<string, FileNode>();

  const filtered = items
    .filter(item => !shouldExclude(item.path))
    .filter(item => item.type === 'blob' || item.type === 'tree')
    .sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'tree' ? -1 : 1;
      }
      return a.path.localeCompare(b.path);
    });

  for (const item of filtered) {
    const parts = item.path.split('/');
    const name = parts[parts.length - 1];
    const type = item.type === 'tree' ? 'dir' : 'file';

    const node: FileNode = {
      name,
      path: item.path,
      type,
      ...(type === 'dir' ? { children: [] } : {}),
    };

    map.set(item.path, node);

    if (parts.length === 1) {
      root.push(node);
    } else {
      const parentPath = parts.slice(0, -1).join('/');
      const parent = map.get(parentPath);
      if (parent && parent.children) {
        parent.children.push(node);
      }
    }
  }

  return root;
}
