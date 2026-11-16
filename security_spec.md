# Mushai Systems — Security Specification & Payload-First TDD

## 1. Core Data Invariants
1. **Strict Tenant Isolation**: No user may read, list, create, update, or delete any document under `/organisations/{orgId}/**` unless an active membership document exists at `/organisations/{orgId}/members/{request.auth.uid}` with `status == 'active'`.
2. **Site-Scoped Access**: Non-admin roles (`plant_head`, `dept_head`, `supervisor`, `operator`, `ehs_manager`, `auditor`, `viewer`) may only create or access site-bound records when `siteId in member.siteIds` (or `org_admin`/`super_admin` override).
3. **Role-Based Permissions**:
   - `viewer` and `auditor` cannot mutate operational records, sites, departments, or memberships.
   - Only `org_admin` / `super_admin` can modify `activeModules`, `members`, or `sites`.
   - Only `org_admin`, `super_admin`, `plant_head`, `dept_head`, `supervisor`, or `ehs_manager` (module-matched) can transition `approvalStatus` to `approved` or `rejected`.
4. **Immutable Audit Trail**: Documents in `audit_logs` are append-only (`create` allowed for active org members with matching `createdBy == request.auth.uid`; `update` and `delete` strictly denied).
5. **Immutable Reports**: Documents in `generated_reports` cannot be silently edited after creation (`update` and `delete` denied except admin cleanup).
6. **Temporal Integrity & Identity**: `createdBy == request.auth.uid`, `createdAt == request.time`, `updatedAt == request.time`, and `organisationId == orgId`.
7. **Terminal State Locking**: Records with `approvalStatus == 'closed'` cannot be updated by non-admins.
8. **PII Isolation**: `/users/{userId}` is strictly readable and writable only by `request.auth.uid == userId`.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Cross-Tenant Read/Write**: Member of `org_alpha` attempts to read or write `/organisations/org_beta/production_logs/log_1` -> `PERMISSION_DENIED`.
2. **Identity Spoofing on Create**: User `uid_a` attempts to create a `production_logs` doc with `createdBy: 'uid_b'` -> `PERMISSION_DENIED`.
3. **Self-Assigned Admin Escalation**: Newly invited user attempts to create `/organisations/org_alpha/members/uid_a` with `role: 'org_admin'` without an existing admin or valid pending invitation -> `PERMISSION_DENIED`.
4. **Shadow Field Injection**: User includes an undocumented ghost field `isSuperVerified: true` on `production_logs` -> `PERMISSION_DENIED` via `keys().hasOnly(...)`.
5. **Timestamp Forgery**: Client sends `createdAt: new Date('2020-01-01')` instead of `serverTimestamp()` -> `PERMISSION_DENIED` via `createdAt == request.time`.
6. **ID Poisoning (1KB ID)**: Client attempts `setDoc(doc(db, 'organisations/org_alpha/sites', 'a'.repeat(300)), ...)` -> `PERMISSION_DENIED` via `isValidId()`.
7. **Email Spoofing Guard**: Authenticated user with `email_verified: false` attempts email-claimed super-admin override or invitation acceptance -> `PERMISSION_DENIED`.
8. **Audit Log Tampering**: Active `org_admin` attempts to `update` or `delete` an existing `audit_logs` entry -> `PERMISSION_DENIED`.
9. **Viewer Role Privilege Bypass**: User with `role: 'viewer'` attempts to create an `incidents` record -> `PERMISSION_DENIED`.
10. **Self-Approval Bypass**: `operator` attempts to update `approvalStatus` from `'submitted'` to `'approved'` -> `PERMISSION_DENIED`.
11. **Terminal Closed State Mutation**: `supervisor` attempts to modify a record where `existing().approvalStatus == 'closed'` -> `PERMISSION_DENIED`.
12. **PII Blanket Read**: Authenticated user `uid_a` attempts to `get` or `list` `/users/uid_b` -> `PERMISSION_DENIED`.
