import { collection, getDocs, addDoc, query, where, serverTimestamp } from "firebase/firestore";
import { db } from "./firebase";

const localDateStr = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;

const hasTodayAttendance = async (userId: string, dateStr: string) => {
  const startOfDay = new Date(dateStr + "T00:00:00");
  const endOfDay   = new Date(dateStr + "T23:59:59");
  const [byDateStr, byTs] = await Promise.all([
    getDocs(query(collection(db,"attendance"), where("userId","==",userId), where("dateStr","==",dateStr))),
    getDocs(query(collection(db,"attendance"), where("userId","==",userId), where("type","==","punch-in"), where("timestamp",">=",startOfDay), where("timestamp","<=",endOfDay))),
  ]);
  return !byDateStr.empty || !byTs.empty;
};

const hasCheckIns = async (userId: string, dateStr: string) => {
  const startOfDay = new Date(dateStr + "T00:00:00");
  const endOfDay   = new Date(dateStr + "T23:59:59");
  const snap = await getDocs(query(collection(db,"checkins"), where("userId","==",userId), where("checkInTime",">=",startOfDay), where("checkInTime","<=",endOfDay)));
  return !snap.empty;
};

export const runBulkAbsentBackfill = async (fromDateStr: string, toDateStr: string) => {
  // Build date list
  const dates: string[] = [];
  const cur = new Date(fromDateStr + "T00:00:00");
  const end = new Date(toDateStr   + "T00:00:00");
  const todayStr = localDateStr(new Date());
  while (cur <= end) {
    const ds = localDateStr(cur);
    if (ds < todayStr) dates.push(ds); // STRICT: never mark today or future
    cur.setDate(cur.getDate() + 1);
  }

  // Load all users
  const [approvedSnap, joinedSnap, policySnap, holidaySnap] = await Promise.all([
    getDocs(query(collection(db,"users"), where("device.approved","==",true))),
    getDocs(query(collection(db,"users"), where("joiningDate","!=",null))),
    getDocs(query(collection(db,"policies"), where("active","==",true))),
    getDocs(collection(db,"holidays")),
  ]);

  const userMap = new Map<string,any>();
  [...approvedSnap.docs,...joinedSnap.docs].forEach(d=>{
    if(!userMap.has(d.id)) userMap.set(d.id,{id:d.id,...d.data()});
  });
  const users = Array.from(userMap.values()).filter(u=>!u.blocked);

  const policies = policySnap.docs.map(d=>({id:d.id,...d.data()} as any));
  const holidays = new Set(holidaySnap.docs.map(d=>(d.data() as any).date as string));

  const getPolicyForUser = (u: any) => {
    for(const p of policies){
      if(p.appliesToAll) return p;
      if((p.departmentIds??[]).includes(u.department)) return p;
    }
    return null;
  };

  let totalMarked = 0, totalSkipped = 0;

  for (const ds of dates) {
    if (holidays.has(ds)) continue;
    const dateObj = new Date(ds + "T00:00:00");
    const dayOfWeek = dateObj.getDay();

    await Promise.all(users.map(async (user) => {
      try {
        // Skip before joining date
        if (user.joiningDate) {
          const joining = new Date(user.joiningDate + "T00:00:00");
          if (dateObj < joining) return;
        }

        // Check working day via policy
        const policy = getPolicyForUser(user);
        const workDays = policy?.workDays ?? [1,2,3,4,5];
        if (!workDays.includes(dayOfWeek)) return;

        // Skip if already has attendance
        const hasAtt = await hasTodayAttendance(user.id, ds);
        if (hasAtt) { totalSkipped++; return; }

        // Skip if has check-ins (field day)
        const hasCIs = await hasCheckIns(user.id, ds);
        if (hasCIs) { totalSkipped++; return; }

        // Mark absent
        await addDoc(collection(db,"attendance"), {
          userId: user.id,
          userName: user.name ?? user.email ?? "Unknown",
          type: "absent",
          status: "absent",
          dateStr: ds,
          timestamp: serverTimestamp(),
        });
        totalMarked++;
      } catch(e: any) {
        console.error("[backfill]", user.id, ds, e.message);
      }
    }));
  }

  return { totalMarked, totalSkipped, datesProcessed: dates.length };
};
