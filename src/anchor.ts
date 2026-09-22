import type { Pool } from 'pg';

interface AnchorConfig {
  githubToken: string;
  owner: string;
  repo: string;
  path?: string;
}

async function getFileSha(config: AnchorConfig): Promise<string | undefined> {
  const path = config.path ?? 'anchors.log';
  const res = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        Accept: 'application/vnd.github+json',
      },
    },
  );
  if (res.status === 404) return undefined;
  if (!res.ok) throw new Error(`Failed to fetch anchors.log: ${res.status}`);
  const data = await res.json() as { content: string; sha: string };
  return data.sha;
}

async function getFileContent(config: AnchorConfig): Promise<string> {
  const path = config.path ?? 'anchors.log';
  const res = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        Accept: 'application/vnd.github+json',
      },
    },
  );
  if (res.status === 404) return '';
  if (!res.ok) throw new Error(`Failed to fetch anchors.log content: ${res.status}`);
  const data = await res.json() as { content: string };
  return Buffer.from(data.content, 'base64').toString('utf-8');
}

export async function anchorLatestHash(pool: Pool, config: AnchorConfig) {
  const { rows } = await pool.query(
    'SELECT seq, hash FROM audit_log ORDER BY seq DESC LIMIT 1',
  );
  if (rows.length === 0) {
    throw new Error('No events to anchor yet');
  }
  const { seq, hash } = rows[0];
  const timestamp = new Date().toISOString();
  const line = `${timestamp} seq=${seq} hash=${hash}\n`;

  const existingContent = await getFileContent(config);
  const sha = await getFileSha(config);
  const newContent = existingContent + line;

  const path = config.path ?? 'anchors.log';
  const res = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${path}`,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${config.githubToken}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: `chore: anchor hash at seq=${seq}`,
        content: Buffer.from(newContent).toString('base64'),
        ...(sha ? { sha } : {}),
      }),
    },
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`GitHub anchor failed: ${res.status} ${body}`);
  }

  const result = await res.json() as { commit: { sha: string; html_url: string } };
  return {
    seq: Number(seq),
    hash,
    anchoredAt: timestamp,
    commitSha: result.commit.sha,
    commitUrl: result.commit.html_url,
  };
}
