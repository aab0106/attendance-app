"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { getTeamMembersForManager, getDirectorMembers } from "@/lib/team-utils";

interface Leave {
  id:string; userId:string; userName:string; department?:string;
  leaveType:string; leaveLabel?:string; fromDate:string; toDate:string;
  days:number; reason:string; status:string;
  managerStatus?:string; reviewedByManager?:string; managerNote?:string;
  hrStatus?:string; reviewedByHR?:string; hrNote?:string;
  timestamp?:any;
}

const fmtDate = (s:string) => s ? new Date(s+"T00:00:00").toLocaleDateString([],{day:"numeric",month:"short",year:"numeric"}) : "—";
const fmtTs   = (ts:any)   => { if(!ts) return "—"; const d=ts.toDate?ts.toDate():new Date(ts); return d.toLocaleDateString([],{day:"numeric",month:"short",year:"numeric"}); };

const STATUS_COLOR: Record<string,string> = {
  approved:        "bg-green-100 text-green-700",
  rejected:        "bg-red-100 text-red-700",
  pending_manager: "bg-amber-100 text-amber-700",
  pending_hr:      "bg-blue-100 text-blue-700",
};
const STATUS_LABEL: Record<string,string> = {
  approved:"Approved", rejected:"Rejected", pending_manager:"Pending Manager", pending_hr:"Pending HR"
};

export default function LeaveReportPage() {
  const { isAdmin, isHR, isDirector, user, profile } = useAuth();

  const [leaves, setLeaves]       = useState<Leave[]>([]);
  const [depts, setDepts]         = useState<{id:string;name:string}[]>([]);
  const [users, setUsers]         = useState<Map<string,any>>(new Map());
  const [loading, setLoading]     = useState(false);
  const [scopedIds, setScopedIds] = useState<Set<string>|null>(null);

  // Filters
  const [filterDept,   setFilterDept]   = useState("");
  const [filterUser,   setFilterUser]   = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [filterType,   setFilterType]   = useState("");
  const [fromDate,     setFromDate]     = useState("");
  const [toDate,       setToDate]       = useState("");

  useEffect(()=>{
    Promise.all([
      getDocs(query(collection(db,"departments"),where("active","==",true))),
      getDocs(collection(db,"users")),
    ]).then(([dSnap,uSnap])=>{
      setDepts(dSnap.docs.map(d=>({id:d.id,name:(d.data() as any).name})));
      const m=new Map(); uSnap.docs.forEach(d=>m.set(d.id,d.data())); setUsers(m);
    });
  },[]);

  useEffect(()=>{
    if(!user) return;
    if(isAdmin||isHR){setScopedIds(null);return;}
    const load=async()=>{
      const members=isDirector?await getDirectorMembers(user.uid,db):await getTeamMembersForManager(user.uid,db);
      setScopedIds(new Set(members.map((m:any)=>m.id)));
    };
    load();
  },[user,isAdmin,isHR,isDirector]);

  const loadData = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(query(collection(db,"leaves"), orderBy("timestamp","desc")));
      let all = snap.docs.map(d=>({id:d.id,...d.data()} as Leave));
      if(scopedIds) all = all.filter(l=>scopedIds.has(l.userId));
      setLeaves(all);
    } finally { setLoading(false); }
  };

  useEffect(()=>{ loadData(); },[scopedIds]);

  // Apply filters
  const filtered = leaves.filter(l=>{
    if(filterStatus && l.status !== filterStatus) return false;
    if(filterType   && l.leaveType !== filterType) return false;
    if(filterDept   && (users.get(l.userId) as any)?.department !== filterDept) return false;
    if(filterUser   && l.userId !== filterUser) return false;
    if(fromDate     && l.toDate   < fromDate) return false;
    if(toDate       && l.fromDate > toDate)   return false;
    return true;
  });

  // Stats
  const stats = {
    total:    filtered.length,
    approved: filtered.filter(l=>l.status==="approved").length,
    pending:  filtered.filter(l=>l.status==="pending_manager"||l.status==="pending_hr").length,
    rejected: filtered.filter(l=>l.status==="rejected").length,
    days:     filtered.filter(l=>l.status==="approved").reduce((s,l)=>s+l.days,0),
  };

  const leaveTypes = Array.from(new Set(leaves.map(l=>l.leaveType)));

  const exportCSV = () => {
    const h = ["Employee","Department","Leave Type","From","To","Days","Status","Reason","Manager","Manager Note","HR","HR Note","Applied On"];
    const rows = filtered.map(l=>[
      l.userName,
      depts.find(d=>d.id===(users.get(l.userId) as any)?.department)?.name??"—",
      l.leaveLabel??l.leaveType, l.fromDate, l.toDate, l.days,
      STATUS_LABEL[l.status]??l.status, l.reason,
      l.reviewedByManager??"—", l.managerNote??"—",
      l.reviewedByHR??"—", l.hrNote??"—",
      fmtTs(l.timestamp),
    ]);
    const csv=[h,...rows].map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(",")).join("\n");
    const a=document.createElement("a");
    a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));
    a.download=`leave_report_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
  };

  const exportPDF = () => {
    const rows = filtered.map((l,i)=>{
      const deptName = depts.find(d=>d.id===(users.get(l.userId) as any)?.department)?.name??"—";
      const bg = i%2===0?"#fff":"#f9fafb";
      const sc = l.status==="approved"?"#16a34a":l.status==="rejected"?"#dc2626":"#b45309";
      const sb = l.status==="approved"?"#dcfce7":l.status==="rejected"?"#fee2e2":"#fef3c7";
      return `<tr style="background:${bg}">
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:11px;font-weight:600">${l.userName}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:11px;color:#666">${deptName}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:11px">${l.leaveLabel??l.leaveType}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:11px">${fmtDate(l.fromDate)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:11px">${fmtDate(l.toDate)}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:11px;text-align:center;font-weight:700">${l.days}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0">
          <span style="background:${sb};color:${sc};padding:2px 8px;border-radius:10px;font-size:10px;font-weight:700">${STATUS_LABEL[l.status]??l.status}</span>
        </td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:10px;color:#555;max-width:140px">${l.reason}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:10px;color:#888">${l.reviewedByManager??"—"}${l.managerNote?`<br><em>${l.managerNote}</em>`:""}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:10px;color:#888">${l.reviewedByHR??"—"}${l.hrNote?`<br><em>${l.hrNote}</em>`:""}</td>
        <td style="padding:6px 8px;border-bottom:1px solid #f0f0f0;font-size:10px;color:#999">${fmtTs(l.timestamp)}</td>
      </tr>`;
    }).join("");

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Leave Report</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:Arial,sans-serif;padding:20px;color:#111}
    .hdr{display:flex;justify-content:space-between;margin-bottom:18px;padding-bottom:14px;border-bottom:2px solid #1565c0}
    .hdr h1{font-size:18px;font-weight:700;color:#1565c0}.hdr p{color:#666;margin-top:3px;font-size:12px}
    .stats{display:flex;gap:12px;margin-bottom:16px}
    .stat{background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:10px 16px;text-align:center}
    .stat .v{font-size:20px;font-weight:700;color:#0369a1}.stat .l{font-size:9px;color:#666;text-transform:uppercase;margin-top:2px}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th{background:#1565c0;color:#fff;padding:8px;text-align:left;font-size:9px;text-transform:uppercase;letter-spacing:.4px}
    @media print{body{padding:8px}}</style></head><body>
    <div class="hdr">
      <div>
        <h1>Leave Report</h1>
        <p>${isAdmin||isHR?"All Employees":isDirector?"Your Departments":"Your Team"} · ${filtered.length} records</p>
      </div>
      <div style="text-align:right;font-size:12px;color:#666">
        <p>Generated ${new Date().toLocaleString()}</p>
        ${filterDept?`<p>Dept: ${depts.find(d=>d.id===filterDept)?.name??"—"}</p>`:""}
        ${fromDate||toDate?`<p>Period: ${fromDate||"start"} → ${toDate||"now"}</p>`:""}
      </div>
    </div>
    <div class="stats">
      <div class="stat"><div class="v">${stats.total}</div><div class="l">Total</div></div>
      <div class="stat"><div class="v" style="color:#16a34a">${stats.approved}</div><div class="l">Approved</div></div>
      <div class="stat"><div class="v" style="color:#b45309">${stats.pending}</div><div class="l">Pending</div></div>
      <div class="stat"><div class="v" style="color:#dc2626">${stats.rejected}</div><div class="l">Rejected</div></div>
      <div class="stat"><div class="v" style="color:#7c3aed">${stats.days}</div><div class="l">Approved Days</div></div>
    </div>
    <table><thead><tr>
      <th>Employee</th><th>Department</th><th>Leave Type</th><th>From</th><th>To</th>
      <th>Days</th><th>Status</th><th>Reason</th><th>Manager</th><th>HR</th><th>Applied</th>
    </tr></thead><tbody>${rows}</tbody></table>
    <script>window.onload=()=>window.print();</script></body></html>`;
    const w=window.open("","_blank"); if(w){w.document.write(html);w.document.close();}
  };

  const userEntries: [string, any][] = Array.from(users.entries()) as [string, any][];
  const userOptions = filterDept
    ? userEntries.filter(([,u])=>u.department===filterDept).map(([id,u])=>({id,name:u.name??u.email}))
    : userEntries.map(([id,u])=>({id,name:u.name??u.email}));

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Leave Report</h1>
          <p className="text-gray-500 text-sm mt-1">
            {isAdmin||isHR?"All employees":isDirector?"Your departments":"Your team"} · {filtered.length} records
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={loadData} className="border border-gray-200 text-gray-600 px-4 py-2.5 rounded-xl text-sm font-semibold hover:bg-gray-50">Refresh</button>
          <button onClick={exportCSV} className="bg-green-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-700">CSV ↓</button>
          <button onClick={exportPDF} disabled={filtered.length===0} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-indigo-700 disabled:bg-gray-300">🖨️ PDF</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {[
          {l:"Total",         v:stats.total,    c:"bg-blue-100 text-blue-700"},
          {l:"Approved",      v:stats.approved, c:"bg-green-100 text-green-700"},
          {l:"Pending",       v:stats.pending,  c:"bg-amber-100 text-amber-700"},
          {l:"Rejected",      v:stats.rejected, c:"bg-red-100 text-red-700"},
          {l:"Approved Days", v:stats.days,     c:"bg-purple-100 text-purple-700"},
        ].map(s=>(
          <div key={s.l} className={`${s.c} rounded-xl p-3 text-center`}>
            <p className="text-2xl font-bold">{s.v}</p>
            <p className="text-xs font-semibold mt-0.5">{s.l}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6 flex flex-wrap gap-4 items-end">
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">From Date</label>
          <input type="date" value={fromDate} onChange={e=>setFromDate(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">To Date</label>
          <input type="date" value={toDate} onChange={e=>setToDate(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Department</label>
          <select value={filterDept} onChange={e=>{setFilterDept(e.target.value);setFilterUser("");}}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-36">
            <option value="">All departments</option>
            {depts.map(d=><option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Employee</label>
          <select value={filterUser} onChange={e=>setFilterUser(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 min-w-40">
            <option value="">All employees</option>
            {userOptions.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Status</label>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All statuses</option>
            <option value="approved">Approved</option>
            <option value="pending_manager">Pending Manager</option>
            <option value="pending_hr">Pending HR</option>
            <option value="rejected">Rejected</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1.5">Leave Type</label>
          <select value={filterType} onChange={e=>setFilterType(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All types</option>
            {leaveTypes.map(t=><option key={t} value={t}>{t}</option>)}
          </select>
        </div>
        <button onClick={()=>{setFilterDept("");setFilterUser("");setFilterStatus("");setFilterType("");setFromDate("");setToDate("");}}
          className="border border-gray-200 text-gray-500 px-4 py-2.5 rounded-xl text-sm hover:bg-gray-50">
          Clear
        </button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400">Loading...</div>
        ) : filtered.length === 0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="text-3xl mb-2">📋</p>
            <p className="text-sm">No leave records found.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-gray-50 border-b border-gray-100">
                {["Employee","Dept","Leave Type","From","To","Days","Status","Reason","Manager","HR","Applied"].map(h=>(
                  <th key={h} className="px-3 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {filtered.map((l,i)=>{
                  const deptName = depts.find(d=>d.id===(users.get(l.userId) as any)?.department)?.name??"—";
                  return (
                    <tr key={l.id} className={`border-b border-gray-50 hover:bg-gray-50 ${i%2===0?"":"bg-gray-50/40"}`}>
                      <td className="px-3 py-2.5 font-semibold text-gray-800 whitespace-nowrap">{l.userName}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-500">{deptName}</td>
                      <td className="px-3 py-2.5">
                        <span className="text-xs font-semibold bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">{l.leaveLabel??l.leaveType}</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs font-mono">{fmtDate(l.fromDate)}</td>
                      <td className="px-3 py-2.5 text-xs font-mono">{fmtDate(l.toDate)}</td>
                      <td className="px-3 py-2.5 text-center font-bold text-gray-700">{l.days}</td>
                      <td className="px-3 py-2.5">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLOR[l.status]??"bg-gray-100 text-gray-600"}`}>
                          {STATUS_LABEL[l.status]??l.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-500 max-w-xs truncate">{l.reason}</td>
                      <td className="px-3 py-2.5 text-xs text-gray-500">
                        {l.reviewedByManager ?? "—"}
                        {l.managerNote && <p className="text-gray-400 italic">{l.managerNote}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-500">
                        {l.reviewedByHR ?? "—"}
                        {l.hrNote && <p className="text-gray-400 italic">{l.hrNote}</p>}
                      </td>
                      <td className="px-3 py-2.5 text-xs text-gray-400 whitespace-nowrap">{fmtTs(l.timestamp)}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="bg-blue-50 border-t-2 border-blue-200">
                  <td colSpan={5} className="px-3 py-2.5 text-sm font-bold text-blue-800">TOTALS</td>
                  <td className="px-3 py-2.5 text-center font-bold text-blue-800">{filtered.reduce((s,l)=>s+l.days,0)}</td>
                  <td colSpan={5} className="px-3 py-2.5 text-xs text-blue-600">{stats.approved} approved · {stats.pending} pending · {stats.rejected} rejected</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
