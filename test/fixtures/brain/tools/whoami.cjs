// Fake whoami for tests: answers as the person named in FAKE_WHOAMI (default Sam Example).
const roles = require('../.team-config/roles.json');
const who = process.env.FAKE_WHOAMI || 'sam@example.test';
const m = roles.members.find((x) => x.email === who);
if (!m) { console.error('unknown'); process.exit(1); }
const slug = m.name.toLowerCase().replace(/ /g, '-').replace(/[^a-z0-9-]/g, '');
console.log(JSON.stringify({ slug, name: m.name, email: m.email, role: m.role, knownMember: true }));
