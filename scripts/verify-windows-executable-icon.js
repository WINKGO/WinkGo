#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 WINK GO (winkgo.top)
 * SPDX-License-Identifier: Apache-2.0
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const ResEdit = require('resedit');

const hashIconItem = (item) => {
  const bytes = Buffer.from(item.isRaw() ? item.bin : item.generate());
  return crypto.createHash('sha256').update(bytes).digest('hex');
};

const verifyExecutableIcon = (executablePath, iconPath) => {
  const executable = ResEdit.NtExecutable.from(fs.readFileSync(executablePath), { ignoreCert: true });
  const resources = ResEdit.NtExecutableResource.from(executable);
  const groups = ResEdit.Resource.IconGroupEntry.fromEntries(resources.entries);
  if (groups.length === 0) throw new Error(`No icon group was found in ${executablePath}`);

  const embeddedHashes = new Set(
    groups.flatMap((group) => group.getIconItemsFromEntries(resources.entries)).map(hashIconItem)
  );
  const expectedItems = ResEdit.Data.IconFile.from(fs.readFileSync(iconPath)).icons.map(({ data }) => data);
  const missingHashes = expectedItems.map(hashIconItem).filter((hash) => !embeddedHashes.has(hash));
  if (missingHashes.length > 0) {
    throw new Error(
      `Executable icon resources do not match ${path.basename(iconPath)} (${missingHashes.length} missing image(s)).`
    );
  }

  console.log(`Verified ${expectedItems.length} WINK GO icon resources: ${executablePath}`);
};

if (require.main === module) {
  const [executablePath, iconPath] = process.argv.slice(2);
  if (!executablePath || !iconPath) {
    console.error('Usage: verify-windows-executable-icon.js <executable-path> <icon-path>');
    process.exitCode = 2;
  } else {
    try {
      verifyExecutableIcon(path.resolve(executablePath), path.resolve(iconPath));
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}

module.exports = { verifyExecutableIcon };
