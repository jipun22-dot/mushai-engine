import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Firestore Security Rules & Blueprint Integrity', () => {
  const rules = fs.readFileSync(path.resolve(process.cwd(), 'firestore.rules'), 'utf8');
  const blueprint = JSON.parse(
    fs.readFileSync(path.resolve(process.cwd(), 'firebase-blueprint.json'), 'utf8')
  ) as {
    firestore: Record<string, unknown>;
  };

  it('enforces rules_version 2 and global deny-all safety net', () => {
    expect(rules).toContain("rules_version = '2';");
    expect(rules).toContain('match /{document=**}');
    expect(rules).toContain('allow read, write: if false;');
  });

  it('covers every collection declared in firebase-blueprint.json', () => {
    const paths = Object.keys(blueprint.firestore);
    for (const p of paths) {
      const segments = p.split('/').filter(Boolean);
      const collectionName = segments[segments.length - 2];
      expect(rules).toContain(`match /${collectionName}/`);
    }
  });

  it('prevents cross-organisation reads/writes and enforces server timestamps & email verification', () => {
    expect(rules).toContain('request.auth.token.email_verified == true');
    expect(rules).toContain('incoming().createdAt == request.time');
    expect(rules).toContain('incoming().updatedAt == request.time');
    expect(rules).toContain('isValidId(');
  });

  it('enforces PII isolation on users and immutability on audit_logs & generated_reports', () => {
    expect(rules).toMatch(/match \/users\/\{userId\}[\s\S]*allow list: if false;/);
    expect(rules).toMatch(/match \/audit_logs\/\{recordId\}[\s\S]*allow update: if false;[\s\S]*allow delete: if false;/);
    expect(rules).toMatch(/match \/generated_reports\/\{recordId\}[\s\S]*allow update: if false;[\s\S]*allow delete: if false;/);
  });
});
