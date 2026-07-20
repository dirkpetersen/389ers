import fs from 'fs';
import path from 'path';
import { AuditAction, AuditEntry } from '../types/ldap';

let logFilePath = './permissions-changes.log';

export function initAuditLogger(filePath: string): void {
  logFilePath = filePath;
  // Ensure directory exists
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

export function logAuditEntry(entry: AuditEntry): void {
  const line = JSON.stringify(entry) + '\n';
  fs.appendFileSync(logFilePath, line, 'utf8');
}

export function createAuditEntry(
  action: AuditAction,
  actor: string,
  target: string,
  details: Record<string, unknown> = {}
): AuditEntry {
  return {
    timestamp: new Date().toISOString(),
    action,
    actor,
    target,
    details,
  };
}

// Convenience functions for common audit events
export function logAddMember(actor: string, groupDN: string, memberUID: string): void {
  logAuditEntry(createAuditEntry('add_member', actor, groupDN, { memberUID }));
}

export function logRemoveMember(actor: string, groupDN: string, memberUID: string): void {
  logAuditEntry(createAuditEntry('remove_member', actor, groupDN, { memberUID }));
}

export function logCreateGroup(actor: string, groupDN: string, cn: string, gidNumber: number): void {
  logAuditEntry(createAuditEntry('create_group', actor, groupDN, { cn, gidNumber }));
}

export function logDeleteGroup(actor: string, groupDN: string, cn: string): void {
  logAuditEntry(createAuditEntry('delete_group', actor, groupDN, { cn }));
}

export function logModifyGroup(actor: string, groupDN: string, changes: Record<string, unknown>): void {
  logAuditEntry(createAuditEntry('modify_group', actor, groupDN, { changes }));
}
