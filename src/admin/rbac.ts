export const PERMISSIONS = [
  'dashboard:read',
  'analytics:read',
  'users:read',
  'users:write',
  'users:moderate',
  'users:delete',
  'purchases:read',
  'purchases:write',
  'content:read',
  'content:write',
  'broadcasts:read',
  'broadcasts:write',
  'operations:read',
  'operations:write',
  'settings:read',
  'settings:write',
  'admins:read',
  'admins:write',
  'audit:read'
] as const;

export type Permission = typeof PERMISSIONS[number];
export type AdminRole = 'superadmin' | 'manager' | 'operator' | 'moderator' | 'content' | 'analyst';

const rolePermissions: Record<AdminRole, readonly Permission[]> = {
  superadmin: PERMISSIONS,
  manager: PERMISSIONS.filter(permission => !['admins:write','users:delete'].includes(permission)),
  operator: ['dashboard:read','analytics:read','users:read','users:write','users:moderate','purchases:read','operations:read','operations:write','broadcasts:read','broadcasts:write','content:read'],
  moderator: ['dashboard:read','users:read','users:moderate','operations:read','operations:write'],
  content: ['dashboard:read','analytics:read','content:read','content:write','broadcasts:read','broadcasts:write'],
  analyst: ['dashboard:read','analytics:read','users:read','purchases:read','content:read','operations:read','audit:read']
};

export interface AdminPrincipal {
  id: string;
  username: string;
  role: AdminRole;
  permissions: Permission[];
  sessionVersion: number;
}

export function effectivePermissions(role: AdminRole, overrides: unknown): Permission[] {
  const extras = Array.isArray(overrides) ? overrides.filter((value): value is Permission => PERMISSIONS.includes(value as Permission)) : [];
  return [...new Set([...rolePermissions[role], ...extras])];
}

export function hasPermission(admin: AdminPrincipal, permission: Permission): boolean {
  return admin.role === 'superadmin' || admin.permissions.includes(permission);
}
