import { describe, expect, it } from 'vitest';
import { LAUNCH_AGENT_LABEL, type LaunchAgentSpec } from '../../shared/install-contract.ts';
import { renderLaunchAgent } from './plist.ts';

const spec = (over: Partial<LaunchAgentSpec> = {}): LaunchAgentSpec => ({
  label: LAUNCH_AGENT_LABEL,
  node: '/Users/a/app/bin/node',
  entry: '/Users/a/app/server/index.ts',
  appRoot: '/Users/a/app',
  path: ['/Users/a/app/bin', '/usr/bin', '/bin'],
  logFile: '/Users/a/Library/Logs/TDS Brain/server.log',
  env: { TDS_BRAIN_SERVICE: '1', LANG: 'en_GB.UTF-8' },
  throttleSeconds: 10,
  exitTimeoutSeconds: 30,
  serviceExecutable: '/Users/a/Applications/TDS Brain Sign-in.app/Contents/MacOS/tds-brain-service',
  ...over,
});

describe('renderLaunchAgent', () => {
  it('writes the keys launchd needs', () => {
    const xml = renderLaunchAgent(spec());
    expect(xml).toContain('<?xml version="1.0" encoding="UTF-8"?>');
    expect(xml).toContain(`<key>Label</key>\n  <string>${LAUNCH_AGENT_LABEL}</string>`);
    expect(xml).toContain(
      '<key>ProgramArguments</key>\n  <array>\n    <string>/Users/a/Applications/TDS Brain Sign-in.app/Contents/MacOS/tds-brain-service</string>\n  </array>',
    );
    expect(xml).toContain('<key>RunAtLoad</key>\n  <true/>');
    expect(xml).toContain('<key>KeepAlive</key>\n  <true/>');
    expect(xml).toContain('<key>ThrottleInterval</key>\n  <integer>10</integer>');
    expect(xml).toContain('<key>ExitTimeOut</key>\n  <integer>30</integer>');
    expect(xml).toContain('<key>WorkingDirectory</key>\n  <string>/Users/a/app</string>');
    expect(xml).toContain(
      '<key>StandardOutPath</key>\n  <string>/Users/a/Library/Logs/TDS Brain/server.log</string>',
    );
    expect(xml).toContain(
      '<key>StandardErrorPath</key>\n  <string>/Users/a/Library/Logs/TDS Brain/server.log</string>',
    );
  });

  it('joins PATH and adds the spec env', () => {
    const xml = renderLaunchAgent(
      spec({ env: { TDS_BRAIN_SERVICE: '1', LANG: 'en_GB.UTF-8', TDS_BRAIN_APP_PORT: '3999' } }),
    );
    expect(xml).toContain('<key>PATH</key>\n    <string>/Users/a/app/bin:/usr/bin:/bin</string>');
    expect(xml).toContain('<key>TDS_BRAIN_SERVICE</key>\n    <string>1</string>');
    expect(xml).toContain('<key>LANG</key>\n    <string>en_GB.UTF-8</string>');
    expect(xml).toContain('<key>TDS_BRAIN_APP_PORT</key>\n    <string>3999</string>');
  });

  it('escapes XML in every value', () => {
    const xml = renderLaunchAgent(spec({ appRoot: `/Users/a/R&D <"x"> 'y'` }));
    expect(xml).toContain('/Users/a/R&amp;D &lt;&quot;x&quot;&gt; &apos;y&apos;');
    expect(xml).not.toContain('R&D');
  });
});
