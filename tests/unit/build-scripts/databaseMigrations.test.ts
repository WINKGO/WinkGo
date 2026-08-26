import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, describe, expect, it } from 'vitest';

type MigrationVerifier = {
  verifyDatabaseMigrations: (repoRoot?: string) => {
    count: number;
    versions: number[];
    latestVersion: number;
    minimumAppVersion: string;
  };
};

const require = createRequire(import.meta.url);
const verifier = require('../../../scripts/verify-database-migrations.cjs') as MigrationVerifier;
const projectRoot = resolve(__dirname, '../../..');
const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

describe('database migration release verification', () => {
  it('locks every migration already shipped to WINK GO users', () => {
    const result = verifier.verifyDatabaseMigrations(projectRoot);

    expect(result.latestVersion).toBe(35);
    expect(result.minimumAppVersion).toBe('2.2.12');
    expect(result.versions).toContain(35);
    expect(result.count).toBe(result.versions.length);
  });

  it('rejects a release checkout that drops an already shipped migration', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-migrations-'));
    temporaryRoots.push(root);
    const migrationDir = join(root, 'backend', 'crates', 'winkgo-db', 'migrations');
    mkdirSync(migrationDir, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '2.2.12' }));
    writeFileSync(join(migrationDir, '001_initial.sql'), 'SELECT 1;\n');
    writeFileSync(
      join(migrationDir, 'migration-lock.json'),
      JSON.stringify({
        schemaVersion: 1,
        minimumAppVersion: '2.2.12',
        migrations: [
          {
            version: 1,
            file: '001_initial.sql',
            sha384: '24454095d8d7876ca8e842f34296ca645c83e0f7b50f048c99db4b2ff4da659267afc4ef3e994f3d74e18c741165d931',
          },
          { version: 34, file: '034_required.sql', sha384: 'e'.repeat(96) },
        ],
      })
    );

    expect(() => verifier.verifyDatabaseMigrations(root)).toThrow(/034_required\.sql.*missing/i);
  });

  it('rejects edits to an already shipped migration', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-migrations-'));
    temporaryRoots.push(root);
    const migrationDir = join(root, 'backend', 'crates', 'winkgo-db', 'migrations');
    mkdirSync(migrationDir, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '2.2.12' }));
    writeFileSync(join(migrationDir, '001_initial.sql'), 'SELECT 2;\n');
    writeFileSync(
      join(migrationDir, 'migration-lock.json'),
      JSON.stringify({
        schemaVersion: 1,
        minimumAppVersion: '2.2.12',
        migrations: [{ version: 1, file: '001_initial.sql', sha384: '0'.repeat(96) }],
      })
    );

    expect(() => verifier.verifyDatabaseMigrations(root)).toThrow(/001_initial\.sql.*checksum/i);
  });

  it('rejects reusing an application version below the migration release floor', () => {
    const root = mkdtempSync(join(tmpdir(), 'winkgo-migrations-'));
    temporaryRoots.push(root);
    const migrationDir = join(root, 'backend', 'crates', 'winkgo-db', 'migrations');
    mkdirSync(migrationDir, { recursive: true });
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '2.2.11' }));
    writeFileSync(join(migrationDir, '001_initial.sql'), 'SELECT 1;\n');
    writeFileSync(
      join(migrationDir, 'migration-lock.json'),
      JSON.stringify({
        schemaVersion: 1,
        minimumAppVersion: '2.2.12',
        migrations: [
          {
            version: 1,
            file: '001_initial.sql',
            sha384: '24454095d8d7876ca8e842f34296ca645c83e0f7b50f048c99db4b2ff4da659267afc4ef3e994f3d74e18c741165d931',
          },
        ],
      })
    );

    expect(() => verifier.verifyDatabaseMigrations(root)).toThrow(
      /2\.2\.11.*older than database migration release floor 2\.2\.12/i
    );
  });
});
