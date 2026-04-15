import { collection, getDocs, query, where, doc, getDoc, Firestore } from "firebase/firestore";

function hasRole(user: any, role: string): boolean {
  const roles = Array.isArray(user.role)
    ? user.role
    : (user.role ?? "employee").split(",").map((r: string) => r.trim());
  return roles.includes(role);
}

// ── Manager: sees own department + sub-departments ────────────────────────────
export async function getTeamMembersForManager(managerUid: string, db: Firestore) {
  const managerDoc  = await getDoc(doc(db, "users", managerUid)).catch(() => null);
  const managerData = managerDoc?.exists() ? managerDoc.data() : null;
  const managerDept = managerData?.department ?? null;

  let deptIds: string[] = [];

  // Explicit headIds
  const explicitSnap = await getDocs(query(
    collection(db, "departments"),
    where("active", "==", true),
    where("headIds", "array-contains", managerUid)
  ));
  if (!explicitSnap.empty) deptIds = explicitSnap.docs.map(d => d.id);

  // Auto-derive: manager role + in a dept → manages that dept
  if (managerDept && hasRole(managerData, "manager") && !deptIds.includes(managerDept)) {
    deptIds.push(managerDept);
  }

  if (deptIds.length === 0) return []; // no dept found — return empty not all users

  const allDeptsSnap = await getDocs(query(collection(db, "departments"), where("active", "==", true)));
  const allDepts     = allDeptsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  const subDeptIds   = allDepts.filter((d: any) => d.parentDeptId && deptIds.includes(d.parentDeptId)).map((d: any) => d.id);
  const allDeptIds   = Array.from(new Set([...deptIds, ...subDeptIds]));
  const deptNames    = allDeptsSnap.docs.filter(d => allDeptIds.includes(d.id)).map(d => d.data().name as string);

  const userSnaps = await Promise.all([
    ...allDeptIds.map(dId => getDocs(query(collection(db, "users"), where("department", "==", dId)))),
    ...deptNames.map(name => getDocs(query(collection(db, "users"), where("department", "==", name)))),
  ]);

  const seen = new Set<string>(); const members: any[] = [];
  for (const snap of userSnaps) {
    for (const d of snap.docs) {
      if (!seen.has(d.id) && d.id !== managerUid) {
        seen.add(d.id); members.push({ id: d.id, ...d.data() });
      }
    }
  }
  if (members.length > 0) return members;

  // Fallback: teams collection (legacy)
  const teamSnap = await getDocs(query(collection(db, "teams"), where("active", "==", true), where("managerIds", "array-contains", managerUid)));
  if (!teamSnap.empty) {
    const uids = Array.from(new Set(teamSnap.docs.flatMap(d => (d.data().memberIds ?? []) as string[])));
    const users = await Promise.all(uids.map(uid => getDoc(doc(db, "users", uid)).then(d => d.exists() ? { id: d.id, ...d.data() } : null).catch(() => null)));
    const result = users.filter(Boolean);
    if (result.length > 0) return result;
  }
  return [];
}

// ── Director: sees their top-level dept + all sub-departments ─────────────────
export async function getDirectorMembers(directorUid: string, db: Firestore) {
  const directorDoc  = await getDoc(doc(db, "users", directorUid)).catch(() => null);
  const directorData = directorDoc?.exists() ? directorDoc.data() : null;
  const directorDept = directorData?.department ?? null;

  let topDeptIds: string[] = [];

  // Explicit directorIds assignment on department docs
  const explicitSnap = await getDocs(query(
    collection(db, "departments"),
    where("active", "==", true),
    where("directorIds", "array-contains", directorUid)
  ));
  if (!explicitSnap.empty) topDeptIds = explicitSnap.docs.map(d => d.id);

  // Auto-derive: director role + in a dept
  if (directorDept && hasRole(directorData, "director")) {
    // Get their department doc
    const theirDeptDoc = await getDoc(doc(db, "departments", directorDept)).catch(() => null);
    if (theirDeptDoc?.exists()) {
      const theirDept = theirDeptDoc.data() as any;
      // If they're in a sub-dept, use the parent as top level
      // If they're in a top-level dept, use that dept
      const target = theirDept.parentDeptId || directorDept;
      if (!topDeptIds.includes(target)) topDeptIds.push(target);
    } else if (!topDeptIds.includes(directorDept)) {
      topDeptIds.push(directorDept);
    }
  }

  // Safety: if still no depts found, return empty — never return all users
  if (topDeptIds.length === 0) return [];

  // Get all sub-departments under the top-level depts
  const allDeptsSnap = await getDocs(query(collection(db, "departments"), where("active", "==", true)));
  const allDepts     = allDeptsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  const subDeptIds   = allDepts.filter((d: any) => d.parentDeptId && topDeptIds.includes(d.parentDeptId)).map((d: any) => d.id);
  const allDeptIds   = Array.from(new Set([...topDeptIds, ...subDeptIds]));
  const deptNames    = allDeptsSnap.docs.filter(d => allDeptIds.includes(d.id)).map(d => d.data().name as string);

  const userSnaps = await Promise.all([
    ...allDeptIds.map(dId => getDocs(query(collection(db, "users"), where("department", "==", dId)))),
    ...deptNames.map(name => getDocs(query(collection(db, "users"), where("department", "==", name)))),
  ]);

  const seen = new Set<string>(); const members: any[] = [];
  for (const snap of userSnaps) {
    for (const d of snap.docs) {
      if (!seen.has(d.id)) { seen.add(d.id); members.push({ id: d.id, ...d.data() }); }
    }
  }
  return members;
}
