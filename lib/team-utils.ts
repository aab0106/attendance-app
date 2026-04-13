import { collection, getDocs, query, where, doc, getDoc, Firestore } from "firebase/firestore";

// Get members for a department head / manager
export async function getTeamMembersForManager(managerUid: string, db: Firestore) {
  // Check departments where this user is a head
  const deptSnap = await getDocs(query(
    collection(db, "departments"),
    where("active", "==", true),
    where("headIds", "array-contains", managerUid)
  ));

  if (!deptSnap.empty) {
    const deptIds = deptSnap.docs.map(d => d.id);
    const userSnaps = await Promise.all(
      deptIds.map(dId => getDocs(query(collection(db, "users"), where("department", "==", dId))))
    );
    const seen = new Set<string>();
    const members: any[] = [];
    for (const snap of userSnaps) {
      for (const d of snap.docs) {
        if (!seen.has(d.id) && d.id !== managerUid) {
          seen.add(d.id);
          members.push({ id: d.id, ...d.data() });
        }
      }
    }
    if (members.length > 0) return members;
  }

  // Fallback: teams collection
  const teamSnap = await getDocs(query(
    collection(db, "teams"),
    where("active", "==", true),
    where("managerIds", "array-contains", managerUid)
  ));
  if (!teamSnap.empty) {
    const memberUids = [...new Set(teamSnap.docs.flatMap(d => (d.data().memberIds ?? []) as string[]))];
    const users = await Promise.all(
      memberUids.map(uid => getDoc(doc(db, "users", uid)).then(d => d.exists() ? { id: d.id, ...d.data() } : null).catch(() => null))
    );
    return users.filter(Boolean);
  }

  return [];
}

// Get members visible to a director
export async function getDirectorMembers(directorUid: string, db: Firestore) {
  const deptSnap = await getDocs(query(
    collection(db, "departments"),
    where("active", "==", true),
    where("directorIds", "array-contains", directorUid)
  ));
  if (deptSnap.empty) return [];

  const topDeptIds = deptSnap.docs.map(d => d.id);
  const allDeptsSnap = await getDocs(query(collection(db, "departments"), where("active", "==", true)));
  const allDepts = allDeptsSnap.docs.map(d => ({ id: d.id, ...d.data() } as any));
  const subDeptIds = allDepts.filter((d: any) => d.parentDeptId && topDeptIds.includes(d.parentDeptId)).map((d: any) => d.id);
  const allDeptIds = [...new Set([...topDeptIds, ...subDeptIds])];

  const userSnaps = await Promise.all(
    allDeptIds.map(dId => getDocs(query(collection(db, "users"), where("department", "==", dId))))
  );
  const seen = new Set<string>();
  const members: any[] = [];
  for (const snap of userSnaps) {
    for (const d of snap.docs) {
      if (!seen.has(d.id)) { seen.add(d.id); members.push({ id: d.id, ...d.data() }); }
    }
  }
  return members;
}
