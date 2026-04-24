"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { getTeamMembersForManager, getDirectorMembers } from "@/lib/team-utils";

interface Record {
  id:string; userId:string; userName:string; type:string; status:string;
  punchInTime?:any; punchOutTime?:any; durationMinutes?:number;
  lateStatus?:string; lateMinutes?:number; department?:string; dateStr?:string; timestamp?:any;
  punchLocation?:string; punchSiteName?:string; punchInLocation?:{latitude?:number;longitude?:number;name?:string};
}

const fmt = (ts:any) => {
  if(!ts) return "—";
  const d = ts.toDate?ts.toDate():new Date(ts);
  return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"});
};
const fmtDate = (ts:any) => {
  if(!ts) return "—";
  const d = ts.toDate?ts.toDate():new Date(ts);
  return d.toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"});
};

export default function DailyReportPage() {
  const { isAdmin, isDirector, user } = useAuth();
  const [date, setDate]         = useState(()=>{
    const d=new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
  });
  const [data, setData]         = useState<Record[]>([]);
  const [loading, setLoading]   = useState(false);
  const [search, setSearch]     = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [depts, setDepts]       = useState<{id:string;name:string}[]>([]);
  const [userMap, setUserMap]   = useState<Map<string,any>>(new Map());
  const [scopedIds, setScopedIds] = useState<Set<string>|null>(null);

  // Load departments and user map
  useEffect(()=>{
    Promise.all([
      getDocs(query(collection(db,"departments"),where("active","==",true))),
      getDocs(collection(db,"users")),
    ]).then(([dSnap,uSnap])=>{
      setDepts(dSnap.docs.map(d=>({id:d.id,name:(d.data() as any).name})));
      const m=new Map(); uSnap.docs.forEach(d=>m.set(d.id,d.data())); setUserMap(m);
    });
  },[]);

  // Load role scope
  useEffect(()=>{
    if(!user) return;
    if(isAdmin){ setScopedIds(null); return; }
    const load = async () => {
      const members = isDirector
        ? await getDirectorMembers(user.uid, db)
        : await getTeamMembersForManager(user.uid, db);
      setScopedIds(new Set(members.map((m:any)=>m.id)));
    };
    load();
  },[user,isAdmin,isDirector]);

  useEffect(()=>{ loadData(); },[date]);

  const loadData = async()=>{
    setLoading(true);
    try{
      const start=new Date(date+"T00:00:00"); const end=new Date(date+"T23:59:59");
      const [tsSnap,dsSnap]=await Promise.all([
        getDocs(query(collection(db,"attendance"),where("timestamp",">=",start),where("timestamp","<=",end))),
        getDocs(query(collection(db,"attendance"),where("dateStr","==",date))),
      ]);
      const seen=new Set<string>(); const all:Record[]=[];
      // From timestamp query: only include punch-in (they don't all have dateStr)
      // absent/field-day records MUST match by dateStr, not by when-they-were-created
      tsSnap.docs.forEach(d=>{
        const r = d.data() as any;
        if (r.type !== "absent" && r.type !== "field-day") {
          if(!seen.has(d.id)){seen.add(d.id);all.push({id:d.id,...r} as Record);}
        }
      });
      // From dateStr query: include everything
      dsSnap.docs.forEach(d=>{
        if(!seen.has(d.id)){seen.add(d.id);all.push({id:d.id,...d.data()} as Record);}
      });
      // Get today's date in local YYYY-MM-DD
      const todayDs = (() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();

      // Helper: get YYYY-MM-DD for any record (prefer dateStr, fallback to timestamp)
      const recDate = (r: any) => {
        if (r.dateStr) return r.dateStr;
        if (r.timestamp?.toDate) {
          const d = r.timestamp.toDate();
          return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
        }
        return null;
      };

      // Filter stage 1: never show any absent record for today (ongoing day)
      const filtered = all.filter(r => !(r.type === "absent" && recDate(r) === todayDs));

      // Filter stage 2: for each user+date combo, if there's a punch-in, drop the absent
      const activityMap = new Map<string, Set<string>>(); // "userId:date" → set of types
      filtered.forEach(r => {
        const d = recDate(r);
        if (!d) return;
        const key = `${r.userId}:${d}`;
        if (!activityMap.has(key)) activityMap.set(key, new Set());
        activityMap.get(key)!.add(r.type);
      });

      const deduped = filtered.filter(r => {
        if (r.type !== "absent") return true; // keep all non-absent
        const d = recDate(r);
        const key = `${r.userId}:${d}`;
        const types = activityMap.get(key) ?? new Set();
        // If this user has a punch-in or field-day on this date, drop the absent record
        if (types.has("punch-in") || types.has("field-day")) return false;
        return true;
      });

      const final = deduped;
      setData(final);
    } finally{ setLoading(false); }
  };

  // Enrich with real names and apply scope
  const enriched = data.map(r=>({
    ...r,
    userName: (userMap.get(r.userId) as any)?.name ?? r.userName,
    department: r.department ?? (userMap.get(r.userId) as any)?.department,
  })).filter(r => scopedIds===null || scopedIds.has(r.userId)); // ROLE FILTER

  const filtered = enriched.filter(r=>{
    const q=search.toLowerCase();
    const matchSearch=!q||r.userName.toLowerCase().includes(q);
    const matchType=!filterType||r.type===filterType;
    const matchDept=!filterDept||r.department===filterDept;
    return matchSearch&&matchType&&matchDept;
  });

  const exportCSV=()=>{
    const headers=["Date","Employee","Department","Type","Status","Punch In","Punch Out","Location","Duration","Late"];
    const rows=filtered.map(r=>[fmtDate(r.punchInTime??r.timestamp),r.userName,
      depts.find(d=>d.id===r.department)?.name??r.department??"—",
      r.type,r.status,fmt(r.punchInTime),fmt(r.punchOutTime),
      r.punchSiteName??r.punchLocation??r.punchInLocation?.name??"—",
      r.durationMinutes?`${Math.floor(r.durationMinutes/60)}h${r.durationMinutes%60}m`:"—",
      r.lateStatus==="late"?`${r.lateMinutes}min`:"—"]);
    const csv=[headers,...rows].map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(",")).join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`daily_${date}.csv`;a.click();
  };

  const exportPDF=()=>{
    const rows=filtered.map((r,i)=>`<tr style="background:${i%2===0?"#fff":"#f9fafb"}">
      <td style="padding:7px 10px">${fmtDate(r.punchInTime??r.timestamp)}</td>
      <td style="padding:7px 10px;font-weight:600">${r.userName}</td>
      <td style="padding:7px 10px;font-size:11px;color:#666">${depts.find(d=>d.id===r.department)?.name??r.department??"—"}</td>
      <td style="padding:7px 10px">${r.type==="punch-in"?"Punch In":r.type==="field-day"?"Field Day":"Absent"}</td>
      <td style="padding:7px 10px"><span style="padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;background:${r.status==="approved"?"#dcfce7":r.status==="absent"?"#fee2e2":"#fef3c7"};color:${r.status==="approved"?"#16a34a":r.status==="absent"?"#dc2626":"#b45309"}">${r.status}</span></td>
      <td style="padding:7px 10px;font-family:monospace">${fmt(r.punchInTime)}</td>
      <td style="padding:7px 10px;font-family:monospace">${fmt(r.punchOutTime)}</td>
      <td style="padding:7px 10px;font-size:11px;color:#555">${r.punchSiteName??r.punchLocation??r.punchInLocation?.name??"—"}</td>
      <td style="padding:7px 10px">${r.durationMinutes?Math.floor(r.durationMinutes/60)+"h "+r.durationMinutes%60+"m":"—"}</td>
      <td style="padding:7px 10px;color:${r.lateStatus==="late"?"#ea580c":"#999"}">${r.lateStatus==="late"?r.lateMinutes+"m late":"—"}</td>
    </tr>`).join("");
    const html=`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Daily Report ${date}</title>
    <style>body{font-family:Arial,sans-serif;padding:24px}h1{font-size:20px;color:#1565c0;margin:0 0 4px}
    p{color:#666;font-size:13px;margin:0 0 20px}table{width:100%;border-collapse:collapse;font-size:12px}
    th{background:#1565c0;color:#fff;padding:9px;text-align:left;font-size:10px;text-transform:uppercase}
    @media print{body{padding:0}}</style></head><body>
    <h1>Daily Attendance Report</h1>
    <p>${new Date(date+"T00:00:00").toLocaleDateString([],{weekday:"long",year:"numeric",month:"long",day:"numeric"})} · ${filtered.length} records</p>
    <table><thead><tr><th>Date</th><th>Employee</th><th>Dept</th><th>Type</th><th>Status</th><th>Punch In</th><th>Punch Out</th><th>Location</th><th>Duration</th><th>Late</th></tr></thead>
    <tbody>${rows}</tbody></table><script>window.onload=()=>window.print();</script></body></html>`;
    const w=window.open("","_blank");if(w){w.document.write(html);w.document.close();}
  };

  const scopeLabel = isAdmin?"All employees":isDirector?"Your departments":"Your team";

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Daily Report</h1>
          <p className="text-gray-500 text-sm mt-1">
            {scopeLabel}
            {scopedIds && <span className="ml-2 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold">{scopedIds.size} employees in scope</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="bg-green-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-700">CSV ↓</button>
          <button onClick={exportPDF} disabled={filtered.length===0} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:bg-gray-300">🖨️ PDF</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6 flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">Date</label>
          <input type="date" value={date} onChange={e=>setDate(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>
        <div className="flex-1 min-w-40">
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">Search</label>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Employee name..."
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">Department</label>
          <select value={filterDept} onChange={e=>setFilterDept(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All</option>
            {depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">Type</label>
          <select value={filterType} onChange={e=>setFilterType(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All</option>
            <option value="punch-in">Punch In</option>
            <option value="field-day">Field Day</option>
            <option value="absent">Absent</option>
          </select>
        </div>
        <button onClick={loadData} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700">Refresh</button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[
          {l:"Present",v:enriched.filter(r=>r.type==="punch-in").length,c:"bg-green-100 text-green-700"},
          {l:"Absent",v:enriched.filter(r=>r.type==="absent").length,c:"bg-red-100 text-red-700"},
          {l:"Field Day",v:enriched.filter(r=>r.type==="field-day").length,c:"bg-blue-100 text-blue-700"},
          {l:"Late",v:enriched.filter(r=>r.lateStatus==="late").length,c:"bg-orange-100 text-orange-700"},
        ].map(s=>(
          <div key={s.l} className={`${s.c} rounded-xl p-4 text-center`}>
            <p className="text-2xl font-bold">{s.v}</p>
            <p className="text-xs font-semibold mt-1">{s.l}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading?<div className="p-12 text-center text-gray-400">Loading...</div>:(
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                {["Employee","Department","Type","Status","Punch In","Punch Out","Location","Duration","Late"].map(h=>(
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.length===0?<tr><td colSpan={9} className="px-4 py-10 text-center text-gray-400 text-sm">No records found.</td></tr>
                :filtered.map((r,i)=>(
                  <tr key={r.id} className={`border-b border-gray-50 ${i%2===0?"":"bg-gray-50/50"}`}>
                    <td className="px-4 py-3 text-sm font-semibold text-gray-800">{r.userName}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{depts.find(d=>d.id===r.department)?.name??r.department??"—"}</td>
                    <td className="px-4 py-3 text-xs font-semibold">{r.type==="punch-in"?"⏰ Punch In":r.type==="field-day"?"🌿 Field Day":"❌ Absent"}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.status==="approved"?"bg-green-100 text-green-700":r.status==="absent"?"bg-red-100 text-red-700":"bg-amber-100 text-amber-700"}`}>{r.status}</span>
                    </td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-600">{fmt(r.punchInTime)}</td>
                    <td className="px-4 py-3 text-xs font-mono text-gray-600">{fmt(r.punchOutTime)}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {(r.punchSiteName || r.punchLocation || r.punchInLocation?.name) ? (
                        <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full text-xs font-medium">
                          📍 {r.punchSiteName ?? r.punchLocation ?? r.punchInLocation?.name}
                        </span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600">{r.durationMinutes?`${Math.floor(r.durationMinutes/60)}h ${r.durationMinutes%60}m`:"—"}</td>
                    <td className="px-4 py-3">{r.lateStatus==="late"?<span className="text-xs font-bold text-orange-600">{r.lateMinutes} min</span>:<span className="text-xs text-gray-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
