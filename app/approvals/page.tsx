"use client";
import { useEffect, useState, useCallback } from "react";
import {
  collection, getDocs, query, where, doc,
  updateDoc, addDoc, serverTimestamp, orderBy, limit
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { getTeamMembersForManager, getDirectorMembers } from "@/lib/team-utils";

interface AttRecord {
  id: string; userId: string; userName: string; type: string;
  status: string; punchInTime?: any; punchOutTime?: any;
  durationMinutes?: number; lateStatus?: string; lateMinutes?: number;
  lateApproved?: boolean | null; fieldDaySummary?: string;
  dateStr?: string; timestamp?: any; department?: string;
  collection: "attendance" | "checkins";
  subType?: string; clientName?: string; siteName?: string;
  checkInTime?: any; checkOutTime?: any;
  reviewReason?: string; reversalCount?: number;
}

const fmt = (ts: any) => {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
};

const statusColor = (s: string) =>
  s === "approved" ? "bg-green-100 text-green-700" :
  s === "rejected" ? "bg-red-100 text-red-700" :
  s === "absent"   ? "bg-red-100 text-red-700" :
  "bg-amber-100 text-amber-700";

const typeLabel = (r: AttRecord) => {
  if (r.collection === "checkins") return r.subType === "outer-visit" ? "🚗 Outer Visit" : "📍 Other Site";
  if (r.type === "punch-in")  return "⏰ Punch In";
  if (r.type === "field-day") return "🌿 Field Day";
  if (r.type === "absent")    return "❌ Absent";
  return r.type;
};

function ReasonModal({ action, record, onConfirm, onCancel }: {
  action: "approved" | "rejected";
  record?: any;
  onConfirm: (reason: string, creditMinutes?: number) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  const [creditMins, setCreditMins] = useState<number>(0);
  const isLatePunch = action === "approved" && record?.lateStatus === "late" && record?.type === "punch-in";
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={e => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="bg-white rounded-2xl p-6 w-full max-w-md shadow-xl">
        <h3 className="text-base font-bold text-gray-800 mb-2">
          {action === "approved" ? "Approve Record" : "Reject Record"}
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          {action === "rejected" ? "Reason is required for rejection." : "Optional — add a reason or note."}
        </p>
        {isLatePunch && (
          <div className="mb-4 bg-amber-50 border border-amber-200 rounded-xl p-3">
            <label className="block text-sm font-semibold text-amber-800 mb-1.5">
              🕐 Credit Hours (minutes)
            </label>
            <p className="text-xs text-amber-700 mb-2">
              Employee was late by {record?.lateMinutes} min. Optionally credit minutes back to offset the late penalty.
            </p>
            <input type="number" min={0} max={record?.lateMinutes ?? 0}
              value={creditMins} onChange={e=>setCreditMins(Number(e.target.value)||0)}
              placeholder="0"
              className="w-full border border-amber-300 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"/>
            <p className="text-xs text-amber-600 mt-1">Leave 0 if no credit needed (just approve).</p>
          </div>
        )}
        <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3}
          placeholder={action === "rejected" ? "Enter rejection reason..." : "Optional reason..."}
          className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none mb-4" />
        <div className="flex gap-3">
          <button onClick={onCancel} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50">Cancel</button>
          <button
            onClick={() => { if (action === "rejected" && !reason.trim()) { alert("Reason required for rejection."); return; } onConfirm(reason.trim(), isLatePunch ? creditMins : undefined); }}
            className={`flex-1 text-white rounded-xl py-2.5 text-sm font-semibold ${action === "approved" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}>
            {action === "approved" ? "Approve" : "Reject"}
          </button>
        </div>
      </div>
    </div>
  );
}

function RecordRow({ record, onAction, isAdmin, onOpenModal, selected, onToggle, canApprove, resolveName, resolveDept }: {
  record: AttRecord;
  onAction: (r: AttRecord, action: string, reason: string, creditMinutes?: number) => Promise<void>;
  isAdmin: boolean;
  onOpenModal: (action: "approved"|"rejected") => void;
  selected?: boolean;
  onToggle?: () => void;
  canApprove?: boolean;
  resolveName: (uid:string, fb:string) => string;
  resolveDept: (uid:string, fb?:string) => string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [acting, setActing]     = useState(false);

  const isPending  = record.status === "pending" || record.status === "absent";
  const isLocked   = record.reversalCount && record.reversalCount >= 1 && !isAdmin;

  const handleAction = async (action: string, reason: string) => {
    setActing(true);
    try { await onAction(record, action, reason); }
    finally { setActing(false); }
  };

  return (
    <>
      <tr className={`border-b border-gray-50 hover:bg-gray-50 cursor-pointer ${selected?"bg-blue-50":""}`} onClick={() => setExpanded(v => !v)}>
        <td className="px-2 py-3" onClick={e=>e.stopPropagation()}>
          <input type="checkbox" checked={!!selected} onChange={()=>onToggle?.()} className="w-4 h-4 rounded accent-blue-600"/>
        </td>
        <td className="px-4 py-3">
          <p className="text-sm font-semibold text-gray-800">{resolveName(record.userId, record.userName)}</p>
          <p className="text-xs text-gray-400">{resolveDept(record.userId, record.department)}</p>
        </td>
        <td className="px-4 py-3">
          <span className="text-xs font-semibold">{typeLabel(record)}</span>
          {record.fieldDaySummary && <p className="text-xs text-gray-400 mt-0.5">{record.fieldDaySummary}</p>}
        </td>
        <td className="px-4 py-3 text-xs text-gray-500">{
          (record.type === "absent" || record.type === "field-day") && (record as any).dateStr
            ? new Date((record as any).dateStr + "T00:00:00").toLocaleDateString([], {month:"short", day:"numeric", year:"numeric"})
            : fmt(record.punchInTime ?? record.checkInTime ?? record.timestamp)
        }</td>
        <td className="px-4 py-3">
          {record.lateStatus === "late" && (
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full mr-1 ${record.lateApproved === true ? "bg-green-100 text-green-700" : record.lateApproved === false ? "bg-red-100 text-red-700" : "bg-orange-100 text-orange-700"}`}>
              🕐 {record.lateMinutes}m
            </span>
          )}
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor(record.status)}`}>{record.status}</span>
        </td>
        <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
          {isPending && !isLocked && canApprove!==false && (
            <div className="flex gap-1.5">
              <button onClick={() => onOpenModal("approved")} disabled={acting}
                className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 font-semibold disabled:bg-gray-300">
                Approve
              </button>
              <button onClick={() => onOpenModal("rejected")} disabled={acting}
                className="text-xs bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 font-semibold disabled:bg-gray-100">
                Reject
              </button>
            </div>
          )}
          {isLocked && <span className="text-xs text-gray-400">🔒 Locked</span>}
          {isPending && canApprove===false && <span className="text-xs text-gray-400 italic">View only</span>}
          {!isPending && !isLocked && <span className="text-xs text-gray-400">Reviewed</span>}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-blue-50/50 border-b border-gray-100">
          <td colSpan={6} className="px-6 py-3">
            <div className="grid grid-cols-3 gap-4 text-xs">
              <div><span className="text-gray-400 uppercase font-bold">Punch In</span><p className="text-gray-700 mt-0.5">{fmt(record.punchInTime ?? record.checkInTime)}</p></div>
              <div><span className="text-gray-400 uppercase font-bold">Punch Out</span><p className="text-gray-700 mt-0.5">{fmt(record.punchOutTime ?? record.checkOutTime)}</p></div>
              <div><span className="text-gray-400 uppercase font-bold">Duration</span><p className="text-gray-700 mt-0.5">{record.durationMinutes ? `${Math.floor(record.durationMinutes/60)}h ${record.durationMinutes%60}m` : "—"}</p></div>
              {record.clientName && <div><span className="text-gray-400 uppercase font-bold">Client</span><p className="text-gray-700 mt-0.5">{record.clientName}</p></div>}
              {record.siteName && <div><span className="text-gray-400 uppercase font-bold">Site</span><p className="text-gray-700 mt-0.5">{record.siteName}</p></div>}
              {record.reviewReason && <div><span className="text-gray-400 uppercase font-bold">Review Note</span><p className="text-gray-700 mt-0.5">{record.reviewReason}</p></div>}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default function ApprovalsPage() {
  const [userMap, setUserMap] = useState<Map<string,any>>(new Map());
  const [deptMap, setDeptMap] = useState<Map<string,string>>(new Map());
  const { isAdmin, isManager, isDirector, profile, user } = useAuth();
  const [records, setRecords]     = useState<AttRecord[]>([]);
  const [modalRecord, setModalRecord] = useState<AttRecord|null>(null);
  const [modalAction, setModalAction] = useState<"approved"|"rejected"|null>(null);
  const [loading, setLoading]     = useState(true);
  const [filterType, setFilterType] = useState<"all"|"punch-in"|"absent"|"check-in">("all");
  const [tab, setTab]             = useState<"pending"|"approved"|"rejected"|"all">("pending");
  const [search, setSearch]       = useState("");
  const [deptMembers, setDeptMembers] = useState<string[]>([]);

  const isHR = Array.isArray((profile as any)?.role)
    ? (profile as any).role.includes("hr")
    : (profile as any)?.role === "hr";
  const canApprove = (isAdmin || isManager || isDirector) && !isHR;
  // HR sees all records (same as admin scope) but read-only
  const seeAll = isAdmin || isHR;

  const resolveName = (userId:string, fallback:string) => {
    const u = userMap.get(userId);
    if (!u) return fallback?.includes("@") ? fallback.split("@")[0] : fallback;
    return u.name || u.displayName || (u.email?.split("@")[0]) || fallback || userId;
  };
  const resolveDept = (userId:string, fallback?:string) => {
    const u = userMap.get(userId);
    return deptMap.get(u?.department) || deptMap.get(fallback||"") || "—";
  };

  // Bulk selection state
  // Load users and departments for name/dept resolution
  useEffect(()=>{
    Promise.all([
      getDocs(collection(db,"users")),
      getDocs(query(collection(db,"departments"),where("active","==",true))),
    ]).then(([uSnap,dSnap])=>{
      const um=new Map(); uSnap.docs.forEach(d=>um.set(d.id,d.data())); setUserMap(um);
      const dm=new Map(); dSnap.docs.forEach(d=>dm.set(d.id,(d.data() as any).name)); setDeptMap(dm);
    });
  },[]);
  const [selectedIds, setSelectedIds]       = useState<Set<string>>(new Set());
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const toggleSelect = (id: string) => setSelectedIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });
  const handleBulk = (action: "approved"|"rejected") => {
    if (!selectedIds.size) return;
    const first = filtered.find(r => selectedIds.has(r.id));
    if (first) { setModalRecord(first); setModalAction(action); }
  };
  const handleBulkConfirm = async (reason: string) => {
    if (!modalAction) return;
    setBulkSubmitting(true);
    const act = modalAction;
    for (const r of filtered.filter(r => selectedIds.has(r.id))) {
      try { await handleAction(r, act, reason); } catch {}
    }
    setSelectedIds(new Set());
    setBulkSubmitting(false);
  };

  // Load team members this user can see
  const loadMembers = useCallback(async () => {
    if (!user) return;
    if (isAdmin || isHR) { setDeptMembers([]); return; } // admin and HR see all

    const members = isDirector
      ? await getDirectorMembers(user.uid, db)
      : await getTeamMembersForManager(user.uid, db);
    setDeptMembers(members.map((m: any) => m.id));
  }, [user, isAdmin, isDirector]);

  const loadRecords = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 30); // last 30 days
      const todayDs = (() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();
      const startDs = (() => { const d=new Date(startDate); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();

      // Three queries:
      // 1. attTsSnap: punch-ins by timestamp (last 30 days)
      // 2. attDsSnap: absent/field-day by dateStr (last 30 days) — these may be created RECENTLY for OLD dates
      // 3. allPunchSnap: ALL punch-ins (for building punchKeys to dedup absents) — no time limit
      const [attTsSnap, attDsSnap, ciSnap] = await Promise.all([
        getDocs(query(collection(db, "attendance"), where("timestamp", ">=", startDate), orderBy("timestamp", "desc"), limit(300))),
        getDocs(query(collection(db, "attendance"), where("dateStr", ">=", startDs), where("dateStr", "<=", todayDs))),
        getDocs(query(collection(db, "checkins"), where("timestamp", ">=", startDate), orderBy("timestamp", "desc"), limit(300))),
      ]);

      // Merge attendance: punch-ins from timestamp query + absent/field-day from dateStr query
      // De-dup by document ID
      const attMap = new Map<string, AttRecord>();
      attTsSnap.docs.forEach(d => {
        const r = { id: d.id, collection: "attendance" as const, ...d.data() } as AttRecord;
        // Skip absent/field-day from timestamp query (they belong to dateStr query)
        if (r.type === "absent" || r.type === "field-day") return;
        attMap.set(d.id, r);
      });
      attDsSnap.docs.forEach(d => {
        const r = { id: d.id, collection: "attendance" as const, ...d.data() } as AttRecord;
        if (!attMap.has(d.id)) attMap.set(d.id, r);
      });
      let att: AttRecord[] = Array.from(attMap.values());
      let ci: AttRecord[]  = ciSnap.docs.map(d => ({ id: d.id, collection: "checkins" as const, ...d.data() } as AttRecord));

      // Filter out absent/field-day records that are today or future (today is ongoing)
      att = att.filter(r => {
        if (r.type !== "absent" && r.type !== "field-day") return true;
        const ds = (r as any).dateStr;
        if (!ds) return false; // no dateStr — stale data, skip
        if (ds >= todayDs) return false; // today or future — not valid
        return true;
      });

      // Build punchKeys: every userId+dateStr combo where we KNOW the user has activity
      // Source from BOTH the 30-day query AND the dateStr query (catches records with timestamps outside window)
      const punchKeys = new Set<string>();
      const addPunchKey = (userId: string, ts: any, dateStr?: string) => {
        let ds = dateStr;
        if (!ds && ts?.toDate) {
          const t = ts.toDate();
          ds = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;
        }
        if (ds && userId) punchKeys.add(`${userId}_${ds}`);
      };
      // Punch-ins from attendance
      att.forEach(r => {
        if (r.type === "punch-in") addPunchKey(r.userId, r.timestamp, (r as any).dateStr);
      });
      // Also from raw timestamp query (in case some punch-ins got dropped above)
      attTsSnap.docs.forEach(d => {
        const r = d.data() as any;
        if (r.type === "punch-in") addPunchKey(r.userId, r.timestamp, r.dateStr);
      });
      // Check-ins
      ci.forEach(r => {
        addPunchKey(r.userId, (r as any).checkInTime, (r as any).dateStr);
      });

      // Drop absents where the same user has activity that day
      att = att.filter(r => {
        if (r.type !== "absent") return true;
        const ds = (r as any).dateStr;
        if (!ds) return false;
        return !punchKeys.has(`${r.userId}_${ds}`);
      });

      // Dedup duplicate absent records (same user + dateStr) — keep latest by timestamp
      const absSeen = new Map<string, AttRecord>();
      const others: AttRecord[] = [];
      att.forEach(r => {
        if (r.type === "absent") {
          const ds = (r as any).dateStr;
          if (!ds) return;
          const key = `${r.userId}_${ds}`;
          const existing = absSeen.get(key);
          if (!existing) {
            absSeen.set(key, r);
          } else {
            const tNew = r.timestamp?.toDate?.()?.getTime() ?? 0;
            const tOld = existing.timestamp?.toDate?.()?.getTime() ?? 0;
            if (tNew > tOld) absSeen.set(key, r);
          }
        } else {
          others.push(r);
        }
      });
      att = [...others, ...Array.from(absSeen.values())];

      // Filter to only records this user can see
      if (!seeAll && deptMembers.length > 0) {
        att = att.filter(r => deptMembers.includes(r.userId));
        ci  = ci.filter(r => deptMembers.includes(r.userId));
      }

      setRecords([...att, ...ci].sort((a, b) => {
        const ta = (a.timestamp?.toDate?.() ?? new Date(0)).getTime();
        const tb = (b.timestamp?.toDate?.() ?? new Date(0)).getTime();
        return tb - ta;
      }));
    } finally { setLoading(false); }
  }, [user, isAdmin, isHR, deptMembers]);

  useEffect(() => { loadMembers(); }, [loadMembers]);
  useEffect(() => { if (deptMembers.length > 0 || isAdmin || isHR) loadRecords(); }, [deptMembers, isAdmin, isHR]);

  const handleAction = async (record: AttRecord, action: string, reason: string, creditMinutes?: number) => {
    const ref = doc(db, record.collection, record.id);
    const updates: any = {
      status:       action,
      reviewedAt:   serverTimestamp(),
      reviewedBy:   profile?.name ?? user?.email,
      reviewReason: reason || null,
      reversalCount: (record.reversalCount ?? 0) + (record.status !== "pending" && record.status !== "absent" ? 1 : 0),
    };
    // For late punch-in approvals, credit minutes back to offset late penalty
    if (action === "approved" && record.lateStatus === "late" && record.type === "punch-in") {
      updates.lateApproved = true;
      if (creditMinutes && creditMinutes > 0) {
        updates.lateCreditMinutes = creditMinutes;
      }
    } else if (action === "rejected" && record.lateStatus === "late") {
      updates.lateApproved = false;
    }
    await updateDoc(ref, updates);
    // Log to statusLogs
    await addDoc(collection(db, "statusLogs"), {
      recordId:   record.id,
      collection: record.collection,
      userId:     record.userId,
      fromStatus: record.status,
      toStatus:   action,
      reason:     reason || null,
      creditMinutes: creditMinutes || null,
      reviewedBy: profile?.name ?? user?.email,
      isReversal: record.status !== "pending" && record.status !== "absent",
      timestamp:  serverTimestamp(),
    });
    await loadRecords();
  };

  if (!canApprove && !isHR) return <div className="p-8 text-center text-gray-400">Manager access required.</div>;

  const filtered = records.filter(r => {
    const matchTab = tab === "all" ? true :
      tab === "pending" ? (r.status === "pending" || r.status === "absent") :
      r.status === tab;
    const matchType = filterType === "all" ? true :
      filterType === "check-in" ? r.collection === "checkins" :
      r.type === filterType;
    const q = search.toLowerCase();
    const resolvedName = resolveName(r.userId, r.userName).toLowerCase();
    const matchSearch = !q || resolvedName.includes(q) || r.userName.toLowerCase().includes(q);
    return matchTab && matchType && matchSearch;
  });

  const pendingCount = records.filter(r => r.status === "pending" || r.status === "absent").length;

  return (
    <>
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-3">
            Approvals
            {isHR && <span className="text-xs font-semibold bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full">👁 View Only</span>}
          </h1>
          <p className="text-gray-500 text-sm mt-1">
            {isAdmin ? "All employees" : isDirector ? "Your departments" : "Your team"} · Last 30 days
          </p>
        </div>
        <button onClick={loadRecords} className="text-sm text-blue-600 border border-blue-200 px-4 py-2 rounded-xl hover:bg-blue-50 font-semibold">
          Refresh ↻
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {([
          ["pending", `Pending (${pendingCount})`],
          ["approved", "Approved"],
          ["rejected", "Rejected"],
          ["all", "All"],
        ] as const).map(([v, l]) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === v
                ? v === "pending" ? "bg-amber-500 text-white"
                  : v === "approved" ? "bg-green-600 text-white"
                  : v === "rejected" ? "bg-red-600 text-white"
                  : "bg-blue-600 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}>
            {l}
          </button>
        ))}
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search employee..."
          className="ml-auto border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
      </div>

      {/* Type filter */}
      <div className="flex gap-2 mb-6 flex-wrap items-center">
        <span className="text-xs font-semibold text-gray-500 mr-2">Filter by type:</span>
        {([
          ["all", "All Types"],
          ["punch-in", "🕐 Late Punches"],
          ["absent", "❌ Absent"],
          ["check-in", "📍 Check-ins"],
        ] as const).map(([v, l]) => (
          <button key={v} onClick={() => setFilterType(v as any)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filterType === v
                ? "bg-gray-800 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}>
            {l}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Loading records...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="text-3xl mb-2">✅</p>
            <p className="text-sm">{tab === "pending" ? "No pending records — all caught up!" : "No records found."}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {["","Employee","Type","Time","Status","Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(r => (
                  <RecordRow key={`${r.collection}-${r.id}`} record={r} onAction={handleAction} isAdmin={isAdmin} selected={selectedIds.has(r.id)} onToggle={()=>toggleSelect(r.id)} onOpenModal={(action)=>{setModalRecord(r);setModalAction(action);}} canApprove={canApprove} resolveName={resolveName} resolveDept={resolveDept} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>

    {/* Bulk action bar */}
    {selectedIds.size > 0 && (
      <div className="fixed bottom-6 left-1/2 -translate-x-1/2 bg-white border border-gray-200 shadow-xl rounded-2xl px-6 py-4 flex items-center gap-4 z-40">
        <p className="text-sm font-bold text-gray-700">{selectedIds.size} selected</p>
        <button onClick={()=>handleBulk("approved")} disabled={bulkSubmitting}
          className="bg-green-600 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-green-700 disabled:bg-gray-300">
          ✓ Approve {selectedIds.size}
        </button>
        <button onClick={()=>handleBulk("rejected")} disabled={bulkSubmitting}
          className="bg-red-600 text-white px-5 py-2 rounded-xl text-sm font-semibold hover:bg-red-700 disabled:bg-gray-300">
          ✕ Reject {selectedIds.size}
        </button>
        <button onClick={()=>setSelectedIds(new Set())} className="text-gray-400 hover:text-gray-600 text-sm">
          Clear
        </button>
      </div>
    )}

    {/* Reason modal — outside table to avoid div-in-tbody error */}
    {modalAction && modalRecord && (
      <ReasonModal
        action={modalAction}
        record={modalRecord}
        onConfirm={async (reason, creditMinutes) => {
          const act = modalAction!;
          setModalAction(null);
          setModalRecord(null);
          if(selectedIds.size > 1){
            await handleBulkConfirm(reason);
          } else {
            const rec = modalRecord!;
            await handleAction(rec, act, reason, creditMinutes);
          }
        }}
        onCancel={() => { setModalAction(null); setModalRecord(null); }}
      />
    )}
    </>
  );
}
