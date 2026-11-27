// Demo stand-in: says what the real script can do, so the task panel shows its controls for the help
// pictures, and answers every other request with "nothing to do". It changes nothing.
if (process.argv[2] === 'capabilities') {
  console.log(JSON.stringify({ version: '0.7', features: ['handover', 'attach', 'updates-v1', 'links-v1'] }));
  process.exit(0);
}
console.log(JSON.stringify({ ok: false, error: 'demo' }));
process.exit(1);
