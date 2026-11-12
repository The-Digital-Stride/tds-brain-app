import type { LaunchAgentSpec } from '../../shared/install-contract.ts';

const escapeXml = (s: string): string =>
  s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');

const str = (key: string, value: string, indent = '  '): string =>
  `${indent}<key>${escapeXml(key)}</key>\n${indent}<string>${escapeXml(value)}</string>`;

/** The LaunchAgent plist (installable-app decisions 1 and 2). Pure. */
export function renderLaunchAgent(spec: LaunchAgentSpec): string {
  const env: Record<string, string> = { PATH: spec.path.join(':'), ...spec.env };
  const envLines = Object.entries(env)
    .map(([k, v]) => str(k, v, '    '))
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
${str('Label', spec.label)}
  <key>ProgramArguments</key>
  <array>
    <string>${escapeXml(spec.serviceExecutable)}</string>
  </array>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>${Math.trunc(spec.throttleSeconds)}</integer>
  <key>ExitTimeOut</key>
  <integer>${Math.trunc(spec.exitTimeoutSeconds)}</integer>
${str('WorkingDirectory', spec.appRoot)}
  <key>EnvironmentVariables</key>
  <dict>
${envLines}
  </dict>
${str('StandardOutPath', spec.logFile)}
${str('StandardErrorPath', spec.logFile)}
</dict>
</plist>
`;
}
