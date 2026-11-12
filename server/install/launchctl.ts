import { execFile } from 'node:child_process';
import { LAUNCH_AGENT_LABEL } from '../../shared/install-contract.ts';

/** Runs `launchctl <args>`. Never rejects: failure is a non-zero `code`. Injectable so tests touch nothing. */
export type LaunchRunner = (args: string[]) => Promise<{ code: number; stdout: string; stderr: string }>;

export const defaultLaunchRunner: LaunchRunner = (args) =>
  new Promise((resolve) => {
    execFile('launchctl', args, { timeout: 60_000 }, (err, stdout, stderr) => {
      const code = err ? (typeof err.code === 'number' ? err.code : 1) : 0;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) });
    });
  });

export interface Launchctl {
  /** Stops and unloads the agent. Failure (not loaded) is ignored. */
  bootout(): Promise<void>;
  enable(): Promise<void>;
  bootstrap(plistPath: string): Promise<void>;
  kickstart(): Promise<void>;
  isLoaded(): Promise<boolean>;
  /** True when the person switched the login item off in System Settings. */
  isDisabled(): Promise<boolean>;
}

export function createLaunchctl(
  run: LaunchRunner,
  uid: number,
  label: string = LAUNCH_AGENT_LABEL,
): Launchctl {
  const domain = `gui/${uid}`;
  const target = `${domain}/${label}`;
  const must = async (args: string[], what: string): Promise<void> => {
    const r = await run(args);
    if (r.code !== 0)
      throw new Error(`${what} failed: ${r.stderr.trim() || r.stdout.trim() || `exit ${r.code}`}`);
  };
  return {
    async bootout() {
      await run(['bootout', target]);
    },
    enable: () => must(['enable', target], 'Enabling the service'),
    bootstrap: (plistPath) => must(['bootstrap', domain, plistPath], 'Loading the service'),
    kickstart: () => must(['kickstart', '-k', target], 'Restarting the service'),
    async isLoaded() {
      return (await run(['print', target])).code === 0;
    },
    async isDisabled() {
      const r = await run(['print-disabled', domain]);
      return (
        r.code === 0 &&
        new RegExp(`"${label.replaceAll('.', '\\.')}"\\s*=>\\s*(true|disabled)`).test(r.stdout)
      );
    },
  };
}
