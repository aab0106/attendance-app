"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useAuth } from "@/lib/auth-context";
import { getTeamMembersForManager, getDirectorMembers } from "@/lib/team-utils";
import { db } from "@/lib/firebase";

interface Visit {
  id:string; userId:string; userName:string; subType:string;
  clientName?:string; siteName?:string; purpose?:string;
  status:string; checkInTime?:any; checkOutTime?:any;
  location?:{latitude:number;longitude:number};
  reviewedBy?:string;
}

interface EmployeeGroup {
  userId: string;
  userName: string;
  visits: Visit[];
}

const fmt = (ts:any) => {
  if(!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString([],{month:"short",day:"numeric",hour:"2-digit",minute:"2-digit"});
};

const dur = (a:any, b:any) => {
  if(!a||!b) return "—";
  const da = a.toDate ? a.toDate() : new Date(a);
  const db2 = b.toDate ? b.toDate() : new Date(b);
  const m = Math.round((db2.getTime()-da.getTime())/60000);
  if (m < 0) return "—";
  return `${Math.floor(m/60)}h ${m%60}m`;
};

const statusBadge = (s:string) => ({
  approved: "bg-green-100 text-green-700",
  rejected: "bg-red-100 text-red-700",
  pending:  "bg-amber-100 text-amber-700",
}[s] ?? "bg-gray-100 text-gray-600");

function EmployeeRow({ group, filter }: { group: EmployeeGroup; filter: string }) {
  const [open, setOpen] = useState(false);
  const visits = group.visits.filter(v => filter === "all" || v.subType === filter);
  if (!visits.length) return null;

  const outerCount = visits.filter(v=>v.subType==="outer-visit").length;
  const siteCount  = visits.filter(v=>v.subType==="other-site").length;
  const pending    = visits.filter(v=>v.status==="pending").length;

  return (
    <div className="border border-gray-100 rounded-2xl overflow-hidden mb-3">
      {/* Employee header row */}
      <button onClick={() => setOpen(v=>!v)}
        className="w-full flex items-center gap-4 px-5 py-4 bg-white hover:bg-gray-50 transition-colors text-left">
        <div className="w-10 h-10 bg-blue-600 rounded-full flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          {group.userName[0]?.toUpperCase() ?? "?"}
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-800">{group.userName}</p>
          <p className="text-xs text-gray-400 mt-0.5">
            {visits.length} visit{visits.length!==1?"s":""} · 
            {outerCount > 0 ? ` ${outerCount} outer` : ""}
            {siteCount > 0  ? ` ${siteCount} site` : ""}
            {pending > 0    ? ` · ${pending} pending` : ""}
          </p>
        </div>
        <div className="flex gap-2 items-center">
          {pending > 0 && (
            <span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">
              {pending} pending
            </span>
          )}
          <span className="text-gray-300 text-lg">{open ? "▲" : "▼"}</span>
        </div>
      </button>

      {/* Visit details */}
      {open && (
        <div className="border-t border-gray-100">
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50">
                {["Type","Client / Site","Purpose","Check In","Check Out","Duration","Status","GPS"].map(h=>(
                  <th key={h} className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visits.map((v,i) => (
                <tr key={v.id} className={`border-t border-gray-50 ${i%2===0?"bg-white":"bg-gray-50/50"}`}>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${v.subType==="outer-visit"?"bg-orange-100 text-orange-700":"bg-blue-100 text-blue-700"}`}>
                      {v.subType==="outer-visit"?"🚗 Outer":"📍 Site"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-700">{v.clientName ?? v.siteName ?? "—"}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-36">
                    <p className="truncate">{v.purpose ?? "—"}</p>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{fmt(v.checkInTime)}</td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {v.checkOutTime ? fmt(v.checkOutTime) : <span className="text-green-600 font-semibold">Active</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{dur(v.checkInTime, v.checkOutTime)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge(v.status)}`}>{v.status}</span>
                  </td>
                  <td className="px-4 py-3">
                    {v.location ? (
                      <a href={`https://www.google.com/maps?q=${v.location.latitude},${v.location.longitude}`}
                        target="_blank" rel="noopener"
                        className="text-xs text-blue-600 hover:underline">Map 🗺️</a>
                    ) : <span className="text-xs text-gray-300">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function VisitReportPage() {
  const [month, setMonth]   = useState(() => new Date().toISOString().slice(0,7));
  const [data, setData]     = useState<Visit[]>([]);
  const [loading, setLoading] = useState(false);
  const { isAdmin, isDirector, user } = useAuth();
  const [scopedIds, setScopedIds] = useState<Set<string>|null>(null);
  const [filter, setFilter] = useState<"all"|"outer-visit"|"other-site">("all");
  const [search, setSearch] = useState("");

  useEffect(()=>{
    if(!user) return;
    if(isAdmin){setScopedIds(null);return;}
    const load=async()=>{
      const members=isDirector?await getDirectorMembers(user.uid,db):await getTeamMembersForManager(user.uid,db);
      setScopedIds(new Set(members.map((m:any)=>m.id)));
    };
    load();
  },[user,isAdmin,isDirector]);
  useEffect(() => { loadData(); }, [month]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [year,mon] = month.split("-").map(Number);
      const start = new Date(year,mon-1,1);
      const end   = new Date(year,mon,1);
      const snap  = await getDocs(query(
        collection(db,"checkins"),
        where("checkInTime",">=",start),
        where("checkInTime","<",end)
      ));
      const visits = snap.docs.map(d=>({id:d.id,...d.data()} as Visit));
      // Enrich with actual user names from users collection
      const userIds: string[] = Array.from(new Set(visits.map(v=>v.userId))) as string[];
      const userMap = new Map<string,string>();
      await Promise.all(userIds.map(async (uid: string) => {
        try {
          const { doc: firestoreDoc, getDoc } = await import("firebase/firestore");
          const uSnap = await getDoc(firestoreDoc(db,"users",uid));
          if(uSnap.exists()) {
            const data = uSnap.data() as any;
            userMap.set(uid, data.name ?? data.email ?? uid);
          }
        } catch {}
      }));
      // Apply real names
      const allEnriched = visits.map(v=>({...v, userName: userMap.get(v.userId) ?? v.userName}));
      const enriched = allEnriched.filter(v => scopedIds===null || scopedIds.has(v.userId));
      setData(enriched);
    } finally { setLoading(false); }
  };

  // Group by employee
  const groups: EmployeeGroup[] = [];
  const seen = new Map<string, EmployeeGroup>();
  for (const v of data) {
    const q = search.toLowerCase();
    if (q && !v.userName.toLowerCase().includes(q) && !(v.clientName??"").toLowerCase().includes(q)) continue;
    if (!seen.has(v.userId)) {
      const g = { userId: v.userId, userName: v.userName, visits: [] };
      seen.set(v.userId, g);
      groups.push(g);
    }
    seen.get(v.userId)!.visits.push(v);
  }

  // Stats
  const outerVisits = data.filter(v=>v.subType==="outer-visit").length;
  const otherSite   = data.filter(v=>v.subType==="other-site").length;
  const approved    = data.filter(v=>v.status==="approved").length;
  const pending     = data.filter(v=>v.status==="pending").length;

  const exportCSV = () => {
    const headers = ["Employee","Type","Client/Site","Purpose","Check In","Check Out","Duration","Status","GPS"];
    const rows = data.filter(v => filter==="all"||v.subType===filter).map(v => [
      v.userName, v.subType, v.clientName??v.siteName??"—", v.purpose??"—",
      fmt(v.checkInTime), fmt(v.checkOutTime), dur(v.checkInTime,v.checkOutTime),
      v.status,
      v.location ? `${v.location.latitude},${v.location.longitude}` : "—",
    ]);
    const csv = [headers,...rows].map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    a.download = `visits_${month}.csv`; a.click();
  };

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Visit Report</h1>
          <p className="text-gray-500 text-sm mt-1">
            {isAdmin?"All employees":isDirector?"Your departments":"Your team"} · grouped by employee
          </p>
        </div>
        <button onClick={exportCSV}
          className="bg-green-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-700">
          Export CSV ↓
        </button>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6 flex items-end gap-4 flex-wrap">
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">Month</label>
          <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div className="flex-1 min-w-48">
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">Search employee or client</label>
          <input value={search} onChange={e=>setSearch(e.target.value)}
            placeholder="Name or client..."
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <button onClick={loadData}
          className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700">
          Refresh
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          {l:"Outer Visits",v:outerVisits,c:"bg-orange-100 text-orange-700"},
          {l:"Other Sites", v:otherSite,  c:"bg-blue-100 text-blue-700"},
          {l:"Approved",    v:approved,   c:"bg-green-100 text-green-700"},
          {l:"Pending",     v:pending,    c:"bg-amber-100 text-amber-700"},
        ].map(s=>(
          <div key={s.l} className={`${s.c} rounded-xl p-4 text-center`}>
            <p className="text-2xl font-bold">{s.v}</p>
            <p className="text-xs font-semibold mt-1">{s.l}</p>
          </div>
        ))}
      </div>

      {/* Filter pills */}
      <div className="flex gap-2 mb-5">
        {(["all","outer-visit","other-site"] as const).map(f=>(
          <button key={f} onClick={()=>setFilter(f)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              filter===f?"bg-blue-600 text-white":"bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}>
            {f==="all"?"All Visits":f==="outer-visit"?"🚗 Outer Visits":"📍 Other Sites"}
          </button>
        ))}
        <p className="ml-auto text-sm text-gray-400 self-center">
          {groups.length} employee{groups.length!==1?"s":""} · click to expand
        </p>
      </div>

      {/* Grouped employee rows */}
      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i=><div key={i} className="bg-white rounded-2xl border h-16 animate-pulse"/>)}</div>
      ) : groups.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-3xl mb-2">🚗</p>
          <p className="text-sm">No visits found for this period.</p>
        </div>
      ) : (
        <div>
          {groups.map(g => <EmployeeRow key={g.userId} group={g} filter={filter} />)}
        </div>
      )}
    </div>
  );
}
