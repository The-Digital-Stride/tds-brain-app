/**
 * Opening the app from outside the browser: prove we hold the app's secret to the server already on the
 * port, get a one-time sign-in code, and open it in Chrome (A15). Shared by `server/index.ts` (a second
 * `pnpm start`) and `tds-brain open` (the Sign-in app). The secret itself never leaves this process.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { get as httpGet } from 'node:http';
import { APP_HOST, ROUTES } from '../shared/contract.ts';
import { AUTH_PING_PATH, codeProof, pingProof, safeEqual } from './http/security.ts';

export const appUrl = (port: number): string => `http://${APP_HOST}:${port}`;

export const signInUrl = (port: number, code: string): string =>
  `${appUrl(port)}${ROUTES.auth}?code=${encodeURIComponent(code)}`;

/** Opens a URL in Chrome (the profile used last), else the default browser. */
export function openBrowser(url: string): void {
  if (process.platform === 'darwin') {
    const chrome = spawn('open', ['-a', 'Google Chrome', url], { stdio: 'ignore' });
    const fallback = () => spawn('open', [url], { stdio: 'ignore' }).on('error', () => {});
    chrome.on('error', fallback);
    chrome.on('exit', (code) => {
      if (code !== 0) fallback();
    });
    return;
  }
  // No reliable way to pick Chrome elsewhere yet: the person opens the link themselves.
  console.log(`Open this link in Chrome to use TDS Brain:\n${url}`);
}

/**
 * A plain GET to the app on the port. Uses node:http so no browser-like headers (Origin,
 * Sec-Fetch-*, Cookie) are ever sent: `/auth/code` refuses those.
 */
function launcherGet(port: number, path: string): Promise<{ status: number; body: string } | null> {
  return new Promise((resolve) => {
    const req = httpGet({ host: APP_HOST, port, path, timeout: 2000 }, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        if (body.length < 4096) body += chunk;
      });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: body.trim() }));
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
  });
}

/** True when the server on the port proves it holds this secret (so it really is this app). */
export async function isOurServer(port: number, launchToken: string): Promise<boolean> {
  const nonce = randomBytes(18).toString('base64url');
  const ping = await launcherGet(port, `${AUTH_PING_PATH}?nonce=${nonce}`);
  return ping?.status === 200 && safeEqual(ping.body, pingProof(launchToken, nonce));
}

/**
 * Check the app on the port really is this one (it can prove it holds our secret), then ask it for a
 * one-time sign-in code. Null when nothing answers, something else holds the port, or it refuses.
 */
export async function codeFromRunningServer(port: number, launchToken: string): Promise<string | null> {
  if (!(await isOurServer(port, launchToken))) return null;
  const nonce = randomBytes(18).toString('base64url');
  const proof = codeProof(launchToken, nonce);
  const issued = await launcherGet(
    port,
    `${ROUTES.authCode}?nonce=${encodeURIComponent(nonce)}&proof=${encodeURIComponent(proof)}`,
  );
  return issued?.status === 200 && issued.body ? issued.body : null;
}
