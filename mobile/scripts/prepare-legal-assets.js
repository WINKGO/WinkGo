const fs = require('fs');
const path = require('path');

function prepareMobileLegalAssets({
  repositoryRoot = path.resolve(__dirname, '../..'),
  outputDirectory = path.resolve(__dirname, '../assets/legal'),
} = {}) {
  const legalSources = [
    ['LICENSE', path.join(repositoryRoot, 'LICENSE')],
    ['NOTICE', path.join(repositoryRoot, 'NOTICE')],
    ['THIRD_PARTY_NOTICES.md', path.join(repositoryRoot, 'THIRD_PARTY_NOTICES.md')],
    ['THIRD_PARTY_DEPENDENCIES.json', path.join(repositoryRoot, 'legal', 'THIRD_PARTY_DEPENDENCIES.json')],
    ['THIRD_PARTY_LICENSES.txt', path.join(repositoryRoot, 'legal', 'THIRD_PARTY_LICENSES.txt')],
  ];
  fs.mkdirSync(outputDirectory, { recursive: true });
  for (const [fileName, source] of legalSources) {
    if (!fs.existsSync(source) || fs.statSync(source).size === 0) {
      throw new Error(`Missing or empty mobile legal asset: ${source}`);
    }
    fs.copyFileSync(source, path.join(outputDirectory, fileName));
  }
  return legalSources.map(([fileName]) => path.join(outputDirectory, fileName));
}

module.exports = { prepareMobileLegalAssets };
