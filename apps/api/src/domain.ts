import { permissions, type Role, type Permission } from "@water/contracts";
export function allowed(role: Role, action: Permission) {
  return permissions[role].includes(action);
}
