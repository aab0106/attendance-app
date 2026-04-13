"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";

interface Record { id:string; userId:string; userName:string; type:string; status:string; punchInTime?:any; punchOutTime?:any; durationMinutes?:number; lateStatus?:string; lateMinutes?:number; lateApproved?:boolean|null; department?:string; fieldDaySummary?:string; }

const fmt = (ts:any) => { if (!ts) return "—"; const d = ts.toDate ? ts.toDate() : new Date(ts); return d.toLocaleTimeString([], {hour:"2-digit",minute:"2-digit"}); };
const statusCls = (s:string) => s==="approved"?"bg-green-100 text-green-700":s==="rejected"?"bg-red-100 text-red-700":s==="absent"?"bg-red-100 text-red-700":"bg-amber-100 text-amber-700";
const typeCls = (t:string) => t==="punch-in"?"bg-blue-100 text-blue-700":t==="field-day"?"bg-purple-100 text-purple-700":"bg-red-100 text-red-700";

export default function DailyReportPage() {
  const [date, setDate]   = useState(() => new Date().toISOString().split("T")[0]);
  const [data, setData]   = useState<Record[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch]   = useState("");
  const [filterType, setFilterType] = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [depts, setDepts]           = useState<{id:string;name:string}[]>([]);
  const [users, setUsers]           = useState<Map<string,any>>(new Map());

  useEffect(() => {
    import("firebase/firestore").then(({getDocs:gd, collection:col, query:q, where:w}) => {
      gd(q(col(db,"departments"),w("active","==",true))).then(snap=>setDepts(snap.docs.map(d=>({id:d.id,name:(d.data() as any).name}))));
      gd(col(db,"users")).then(snap=>{const m=new Map();snap.docs.forEach(d=>m.set(d.id,d.data()));setUsers(m);});
    });
  }, []);
  useEffect(()=>{
    import("firebase/firestore").then(({getDocs:gd,collection:col,query:q,where:w})=>{
      gd(q(col(db,"departments"),w("active","==",true))).then(snap=>setDepts(snap.docs.map(d=>({id:d.id,name:(d.data() as any).name}))));
      gd(col(db,"users")).then(snap=>{const m=new Map();snap.docs.forEach(d=>m.set(d.id,d.data()));setUsers(m);});
    });
  },[]);
  useEffect(() => { loadData(); }, [date]);

  const loadData = async () => {
    setLoading(true);
    try {
      const start = new Date(date + "T00:00:00"); const end = new Date(date + "T23:59:59");
      const snap = await getDocs(query(collection(db,"attendance"), where("timestamp",">=",start), where("timestamp","<=",end)));
      setData(snap.docs.map(d => ({id:d.id,...d.data()} as Record)));
    } finally { setLoading(false); }
  };

  const exportCSV = () => {
    const headers = ["Employee","Department","Type","Status","Punch In","Punch Out","Duration","Late","Late Minutes"];
    const rows = filtered.map(r => [r.userName, r.department??"—", r.type, r.status, fmt(r.punchInTime), fmt(r.punchOutTime), r.durationMinutes ? `${Math.floor(r.durationMinutes/60)}h${r.durationMinutes%60}m` : "—", r.lateStatus??"—", r.lateMinutes??0]);
    const csv = [headers,...rows].map(r => r.join(",")).join("\n");
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv],{type:"text/csv"})); a.download = `daily_${date}.csv`; a.click();
  };

  const exportPDF = () => {
    const dateLabel = new Date(date+"T00:00:00").toLocaleDateString([],{weekday:"long",year:"numeric",month:"long",day:"numeric"});
    const rows = filtered.map((r,i) => `<tr style="background:${i%2===0?"#fff":"#f9f9f9"}">
      <td style="padding:8px 10px;font-weight:600">${r.userName}</td>
      <td style="padding:8px 10px;color:#666;font-size:12px">${r.department??"—"}</td>
      <td style="padding:8px 10px">${r.type==="punch-in"?"Punch In":r.type==="field-day"?"Field Day":"Absent"}</td>
      <td style="padding:8px 10px"><span style="padding:2px 8px;border-radius:12px;font-size:11px;font-weight:700;background:${r.status==="approved"?"#dcfce7":r.status==="absent"?"#fee2e2":"#fef3c7"};color:${r.status==="approved"?"#16a34a":r.status==="absent"?"#dc2626":"#b45309"}">${r.status}</span></td>
      <td style="padding:8px 10px">${fmt(r.punchInTime)}</td>
      <td style="padding:8px 10px">${fmt(r.punchOutTime)}</td>
      <td style="padding:8px 10px">${r.durationMinutes?Math.floor(r.durationMinutes/60)+"h "+r.durationMinutes%60+"m":"—"}</td>
      <td style="padding:8px 10px;color:${r.lateStatus==="late"?"#ea580c":"#999"}">${r.lateStatus==="late"?r.lateMinutes+"m late":"—"}</td>
    </tr>`).join("");
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Daily Report — ${dateLabel}</title>
    <style>body{font-family:Arial,sans-serif;padding:24px}h1{font-size:20px;color:#1565c0;margin:0 0 4px}p{color:#666;font-size:13px;margin:0 0 20px}table{width:100%;border-collapse:collapse;font-size:13px}th{background:#1565c0;color:#fff;padding:10px;text-align:left;font-size:11px;text-transform:uppercase}@media print{button{display:none}}</style>
    </head><body><h1>Daily Attendance Report</h1><p>${dateLabel} · ${filtered.length} records · Generated ${new Date().toLocaleString()}</p>
    <table><thead><tr><th>Employee</th><th>Dept</th><th>Type</th><th>Status</th><th>Punch In</th><th>Punch Out</th><th>Duration</th><th>Late</th></tr></thead>
    <tbody>${rows}</tbody></table><script>window.onload=()=>window.print();</script></body></html>`;
    const w=window.open("","_blank"); if(w){w.document.write(html);w.document.close();}
  };

  // Enrich records with actual names from users map
  const enriched = data.map(r => ({
    ...r,
    userName: (users.get(r.userId) as any)?.name ?? r.userName,
    department: r.department ?? (users.get(r.userId) as any)?.department,
  }));
  const filtered = enriched.filter(r => {
    const q = search.toLowerCase();
    const matchSearch = !q || r.userName.toLowerCase().includes(q);
    const matchType   = !filterType || r.type === filterType;
    const matchDept   = !filterDept || r.department === filterDept;
    return matchSearch && matchType && matchDept;
  });

  const present   = data.filter(r => r.type==="punch-in").length;
  const absent    = data.filter(r => r.type==="absent").length;
  const fieldDays = data.filter(r => r.type==="field-day").length;
  const late      = data.filter(r => r.lateStatus==="late").length;

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div><h1 className="text-2xl font-bold text-gray-900">Daily Report</h1><p className="text-gray-500 text-sm mt-1">Attendance records for a specific date</p></div>
        <div className="flex gap-2">
          <button onClick={exportCSV} className="bg-green-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-700">CSV ↓</button>
          <button onClick={exportPDF} className="bg-gray-900 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-red-700">PDF ↓</button>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6 flex items-end gap-4 flex-wrap">
        <div><label className="block text-sm font-semibold text-gray-600 mb-1.5">Date</label>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
        <div className="flex-1 min-w-48"><label className="block text-sm font-semibold text-gray-600 mb-1.5">Search</label>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Employee name..."
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
        <div><label className="block text-sm font-semibold text-gray-600 mb-1.5">Type</label>
          <select value={filterDept} onChange={e=>setFilterDept(e.target.value)}
          className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All departments</option>
          {depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={filterType} onChange={e=>setFilterType(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All types</option><option value="punch-in">Punch In</option><option value="field-day">Field Day</option><option value="absent">Absent</option>
          </select></div>
        <button onClick={loadData} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700">Refresh</button>
      </div>

      <div className="grid grid-cols-4 gap-3 mb-5">
        {[{l:"Present",v:present,c:"bg-green-100 text-green-700"},{l:"Absent",v:absent,c:"bg-red-100 text-red-700"},{l:"Field Days",v:fieldDays,c:"bg-purple-100 text-purple-700"},{l:"Late",v:late,c:"bg-orange-100 text-orange-700"}].map(s=>(
          <div key={s.l} className={`${s.c} rounded-xl p-4 text-center`}><p className="text-2xl font-bold">{s.v}</p><p className="text-xs font-semibold mt-1">{s.l}</p></div>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? <div className="p-12 text-center text-gray-400 text-sm">Loading...</div> : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                {["Employee","Dept","Type","Punch In","Punch Out","Duration","Late","Status"].map(h=>(
                  <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.length===0 ? <tr><td colSpan={8} className="px-4 py-10 text-center text-gray-400 text-sm">No records for this date.</td></tr>
                  : filtered.map((r,i)=>(
                  <tr key={r.id} className={`border-b border-gray-50 ${i%2===0?"":"bg-gray-50/50"}`}>
                    <td className="px-4 py-3"><p className="text-sm font-semibold text-gray-800">{r.userName}</p></td>
                    <td className="px-4 py-3 text-xs text-gray-500">{r.department??"—"}</td>
                    <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${typeCls(r.type)}`}>{r.type==="punch-in"?"Punch In":r.type==="field-day"?"Field Day":"Absent"}</span></td>
                    <td className="px-4 py-3 text-sm text-gray-600">{fmt(r.punchInTime)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{fmt(r.punchOutTime)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{r.durationMinutes?`${Math.floor(r.durationMinutes/60)}h ${r.durationMinutes%60}m`:"—"}</td>
                    <td className="px-4 py-3">{r.lateStatus==="late"?<span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${r.lateApproved===true?"bg-green-100 text-green-700":r.lateApproved===false?"bg-red-100 text-red-700":"bg-orange-100 text-orange-700"}`}>{r.lateMinutes}m {r.lateApproved===true?"excused":r.lateApproved===false?"unexcused":"late"}</span>:<span className="text-xs text-gray-300">—</span>}</td>
                    <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusCls(r.status)}`}>{r.status}</span></td>
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
