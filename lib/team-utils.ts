import { collection, getDocs, query, where, doc, getDoc, Firestore } from "firebase/firestore";

function hasRole(user: any, role: string): boolean {
  const roles = Array.isArray(user.role)
    ? user.role
    : (user.role ?? "employee").split(",").map((r: string) => r.trim());
  return roles.includes(role);
}

export async function getTeamMembersForManager(managerUid: string, db: Firestore) {
  // Get manager's own department
  const managerDoc  = await getDoc(doc(db, "users", managerUid)).catch(() => null);
  const managerData = managerDoc?.exists() ? managerDoc.data() : null;
  const managerDept = managerData?.department ?? null;

  let deptIds: string[] = [];

  // Explicit headIds assignment
  const explicitSnap = await getDocs(query(
    collection(db, "departments"),
    where("active", "==", true),
    where("headIds", "array-contains", managerUid)
  ));
  if (!explicitSnap.empty) deptIds = explicitSnap.docs.map(d => d.id);

  // Auto-derive: manager role + in a department → manages that department
  if (managerDept && hasRole(managerData, "manager") && !deptIds.includes(managerDept)) {
    deptIds.push(managerDept);
  }

  if (deptIds.length > 0) {
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
        if (!seen.has(d.id) && d.id !== managerUid) { seen.add(d.id); members.push({ id: d.id, ...d.data() }); }
      }
    }
    if (members.length > 0) return members;
  }

  // Fallback: teams collection
  const teamSnap = await getDocs(query(collection(db, "teams"), where("active", "==", true), where("managerIds", "array-contains", managerUid)));
  if (!teamSnap.empty) {
    const uids = Array.from(new Set(teamSnap.docs.flatMap(d => (d.data().memberIds ?? []) as string[])));
    const users = await Promise.all(uids.map(uid => getDoc(doc(db, "users", uid)).then(d => d.exists() ? { id: d.id, ...d.data() } : null).catch(() => null)));
    const result = users.filter(Boolean);
    if (result.length > 0) return result;
  }
  return [];
}

export async function getDirectorMembers(directorUid: string, db: Firestore) {
  const directorDoc  = await getDoc(doc(db, "users", directorUid)).catch(() => null);
  const directorData = directorDoc?.exists() ? directorDoc.data() : null;
  const directorDept = directorData?.department ?? null;

  let topDeptIds: string[] = [];

  const explicitSnap = await getDocs(query(collection(db, "departments"), where("active", "==", true), where("directorIds", "array-contains", directorUid)));
  if (!explicitSnap.empty) topDeptIds = explicitSnap.docs.map(d => d.id);

  if (directorDept && hasRole(directorData, "director")) {
    const theirDeptDoc = await getDoc(doc(db, "departments", directorDept)).catch(() => null);
    if (theirDeptDoc?.exists()) {
      const theirDept = theirDeptDoc.data() as any;
      const target = theirDept.parentDeptId ?? directorDept;
      if (!topDeptIds.includes(target)) topDeptIds.push(target);
    }
  }

  if (topDeptIds.length === 0) return [];

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