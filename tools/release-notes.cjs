/** One reviewed Markdown file supplies GitHub, update metadata and the app summary. */
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const releaseUrl = version => `https://github.com/KaiAlan/zoomcast/releases/tag/v${version}`;

function parseNotes(markdown, version) {
  const text = markdown.replaceAll('\r\n', '\n').trim();
  const title = version === 'unreleased' ? '# Unreleased' : `# Zoomcast ${version}`;
  if (!text.startsWith(`${title}\n`)) throw Error(`Release notes must start with ${title}`);
  if (/\b(TODO|TBD|PLACEHOLDER)\b/i.test(text)) throw Error('Release notes contain unfinished placeholders');
  const section = text.match(/^## Highlights\n([\s\S]*?)(?=^## |$(?![\s\S]))/m)?.[1]?.trim();
  if (!section) throw Error('Release notes need a Highlights section for the app');
  const highlights = section.split('\n').filter(line => line.trim()).map(line => {
    if (!line.startsWith('- ') || line.length < 15 || line.length > 242 || /[<>`[\]*]/.test(line)) {
      throw Error('Highlights must be plain-text bullets of 13–240 characters');
    }
    return line.slice(2);
  });
  if (highlights.length < 1 || highlights.length > 5) throw Error('Choose 1–5 release highlights');
  if (!/^## (Added|Changed|Improved|Fixed)\n(?:\n)?- .+/m.test(text)) throw Error('Release notes need detailed Added, Changed, Improved or Fixed entries');
  if (version !== 'unreleased' && !/^## Upgrade notes\n[\s\S]+/m.test(text)) throw Error('Release notes need Upgrade notes');
  return { version, highlights, url: releaseUrl(version), markdown: `${text}\n` };
}

function loadRelease(base = root) {
  const { version } = JSON.parse(fs.readFileSync(path.join(base, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw Error('A stable release must use a major.minor.patch version');
  const lock = JSON.parse(fs.readFileSync(path.join(base, 'package-lock.json'), 'utf8'));
  if (lock.version !== version || lock.packages[''].version !== version) throw Error('Package and lockfile versions must match');
  return parseNotes(fs.readFileSync(path.join(base, 'docs', 'releases', `${version}.md`), 'utf8'), version);
}

function changelog(base = root) {
  const directory = path.join(base, 'docs', 'releases');
  const names = fs.readdirSync(directory).filter(name => /^\d+\.\d+\.\d+\.md$/.test(name));
  names.sort((a, b) => {
    const left = a.split('.').map(Number), right = b.split('.').map(Number);
    return right[0] - left[0] || right[1] - left[1] || right[2] - left[2];
  });
  if (fs.existsSync(path.join(directory, 'unreleased.md'))) names.unshift('unreleased.md');
  const entries = names.map(name => {
    const version = name.slice(0, -3);
    const release = parseNotes(fs.readFileSync(path.join(directory, name), 'utf8'), version);
    const body = release.markdown.replace(/^# /gm, '## ').replace(/^## (Highlights|Added|Changed|Improved|Fixed|Upgrade notes)/gm, '### $1');
    return version === 'unreleased' ? body : body.replace(`## Zoomcast ${version}`, `## [Zoomcast ${version}](${release.url})`);
  });
  return `# Changelog\n\nDetailed changes for each Zoomcast release. The app shows the Highlights from these same notes.\n\n${entries.join('\n')}\n`;
}

function check(base = root) {
  const release = loadRelease(base);
  const expected = changelog(base);
  if (fs.readFileSync(path.join(base, 'CHANGELOG.md'), 'utf8').replaceAll('\r\n', '\n') !== expected) {
    throw Error('CHANGELOG.md is out of date. Run npm run notes:write.');
  }
  if (process.env.GITHUB_REF_TYPE === 'tag' && process.env.GITHUB_REF_NAME !== `v${release.version}`) {
    throw Error('The release tag must match package.json version');
  }
  return release;
}

module.exports = { parseNotes, loadRelease, changelog, check };
if (require.main === module) {
  try {
    if (process.argv.includes('--write')) fs.writeFileSync(path.join(root, 'CHANGELOG.md'), changelog());
    const release = check();
    if (process.argv.includes('--prepare')) fs.writeFileSync(path.join(root, 'build', 'release-notes.md'), release.markdown);
    console.log(`Release ${release.version}: detailed notes, ${release.highlights.length} app highlights and changelog verified`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
