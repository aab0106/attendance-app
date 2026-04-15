"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { getTeamMembersForManager, getDirectorMembers } from "@/lib/team-utils";

interface LateRecord {
  id:string; userId:string; userName:string; department?:string;
  punchInTime?:any; lateMinutes:number; lateApproved?:boolean|null;
  lateReason?:string; lateReviewedBy?:string; dateStr?:string; timestamp?:any;
}
interface EmployeeGroup { userId:string; userName:string; records:LateRecord[]; }

const fmtTime=(ts:any)=>{ if(!ts) return "—"; const d=ts.toDate?ts.toDate():new Date(ts); return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); };
const fmtDate=(ts:any,ds?:string)=>{ if(ds) return new Date(ds+"T00:00:00").toLocaleDateString([],{month:"short",day:"numeric"}); if(!ts) return "—"; const d=ts.toDate?ts.toDate():new Date(ts); return d.toLocaleDateString([],{month:"short",day:"numeric",year:"numeric"}); };
const statusLabel=(v:boolean|null|undefined)=>v===true?"Excused":v===false?"Unexcused":"Pending";
const statusColor=(v:boolean|null|undefined)=>v===true?"bg-green-100 text-green-700":v===false?"bg-red-100 text-red-700":"bg-amber-100 text-amber-700";

function EmployeeGroup({group,filter}:{group:EmployeeGroup;filter:string}){
  const [open,setOpen]=useState(false);
  const records=group.records.filter(r=>{
    if(filter==="pending") return r.lateApproved===null||r.lateApproved===undefined;
    if(filter==="excused") return r.lateApproved===true;
    if(filter==="unexcused") return r.lateApproved===false;
    return true;
  });
  if(!records.length) return null;
  const pending=records.filter(r=>r.lateApproved===null||r.lateApproved===undefined).length;
  const totalMins=records.reduce((a,r)=>a+r.lateMinutes,0);
  return(
    <div className="border border-gray-100 rounded-2xl overflow-hidden mb-3">
      <button onClick={()=>setOpen(v=>!v)} className="w-full flex items-center gap-4 px-5 py-4 bg-white hover:bg-gray-50 transition-colors text-left">
        <div className="w-9 h-9 bg-orange-100 rounded-full flex items-center justify-center text-orange-700 font-bold text-sm flex-shrink-0">{group.userName[0]?.toUpperCase()??"?"}</div>
        <div className="flex-1 min-w-0">
          <p className="font-bold text-gray-800">{group.userName}</p>
          <p className="text-xs text-gray-400 mt-0.5">{records.length} occurrence{records.length!==1?"s":""} · avg {Math.round(totalMins/records.length)} min{pending>0?` · ${pending} pending`:""}</p>
        </div>
        <div className="flex gap-2 items-center">
          {pending>0&&<span className="text-xs bg-amber-100 text-amber-700 font-semibold px-2 py-0.5 rounded-full">{pending} pending</span>}
          <span className="text-orange-500 font-bold text-sm">{totalMins} min total</span>
          <span className="text-gray-300 text-lg">{open?"▲":"▼"}</span>
        </div>
      </button>
      {open&&(
        <div className="border-t border-gray-100">
          <table className="w-full">
            <thead><tr className="bg-gray-50">{["Date","Punch In","Late By","Status","Reason","Reviewed By"].map(h=>(<th key={h} className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase tracking-wide">{h}</th>))}</tr></thead>
            <tbody>
              {records.map((r,i)=>(
                <tr key={r.id} className={`border-t border-gray-50 ${i%2===0?"bg-white":"bg-gray-50/50"}`}>
                  <td className="px-4 py-3 text-sm text-gray-600">{fmtDate(r.punchInTime,r.dateStr)}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 font-mono">{fmtTime(r.punchInTime)}</td>
                  <td className="px-4 py-3"><span className="text-sm font-bold text-orange-600">{r.lateMinutes} min</span></td>
                  <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusColor(r.lateApproved)}`}>{statusLabel(r.lateApproved)}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{r.lateReason??"—"}</td>
                  <td className="px-4 py-3 text-xs text-gray-400">{r.lateReviewedBy??"—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function LateReportPage(){
  const { isAdmin, isDirector, user } = useAuth();
  const [month,setMonth]=useState(()=>new Date().toISOString().slice(0,7));
  const [data,setData]=useState<LateRecord[]>([]);
  const [userMap,setUserMap]=useState<Map<string,any>>(new Map());
  const [loading,setLoading]=useState(false);
  const [filter,setFilter]=useState<"all"|"pending"|"excused"|"unexcused">("all");
  const [search,setSearch]=useState("");
  const [scopedIds,setScopedIds]=useState<Set<string>|null>(null);

  useEffect(()=>{ getDocs(collection(db,"users")).then(snap=>{const m=new Map();snap.docs.forEach(d=>m.set(d.id,d.data()));setUserMap(m);}); },[]);

  useEffect(()=>{
    if(!user) return;
    if(isAdmin){setScopedIds(null);return;}
    const load=async()=>{
      const members=isDirector?await getDirectorMembers(user.uid,db):await getTeamMembersForManager(user.uid,db);
      setScopedIds(new Set(members.map((m:any)=>m.id)));
    };
    load();
  },[user,isAdmin,isDirector]);

  useEffect(()=>{loadData();},[month]);

  const loadData=async()=>{
    setLoading(true);
    try{
      const [year,mon]=month.split("-").map(Number);
      const start=new Date(year,mon-1,1); const end=new Date(year,mon,1);
      const snap=await getDocs(query(collection(db,"attendance"),where("lateStatus","==","late"),where("timestamp",">=",start),where("timestamp","<",end)));
      setData(snap.docs.map(d=>({id:d.id,...d.data()} as LateRecord)));
    } finally{setLoading(false);}
  };

  const enriched=data
    .map(r=>({...r,userName:userMap.get(r.userId)?.name??r.userName,department:r.department??userMap.get(r.userId)?.department}))
    .filter(r=>scopedIds===null||scopedIds.has(r.userId)); // ROLE FILTER

  const tabFiltered=enriched.filter(r=>{
    if(filter==="pending") return r.lateApproved===null||r.lateApproved===undefined;
    if(filter==="excused") return r.lateApproved===true;
    if(filter==="unexcused") return r.lateApproved===false;
    return true;
  });

  const groups:EmployeeGroup[]=[]; const seen=new Map<string,EmployeeGroup>();
  for(const r of tabFiltered){
    const q=search.toLowerCase();
    if(q&&!r.userName.toLowerCase().includes(q)) continue;
    if(!seen.has(r.userId)){const g={userId:r.userId,userName:r.userName,records:[]};seen.set(r.userId,g);groups.push(g);}
    seen.get(r.userId)!.records.push(r);
  }

  const pending=enriched.filter(r=>r.lateApproved===null||r.lateApproved===undefined).length;
  const excused=enriched.filter(r=>r.lateApproved===true).length;
  const unexcused=enriched.filter(r=>r.lateApproved===false).length;

  const exportCSV=()=>{
    const headers=["Date","Employee","Dept","Punch In","Late By (min)","Status","Reason","Reviewed By"];
    const rows=tabFiltered.map(r=>[fmtDate(r.punchInTime,r.dateStr),r.userName,r.department??"—",fmtTime(r.punchInTime),r.lateMinutes,statusLabel(r.lateApproved),r.lateReason??"—",r.lateReviewedBy??"—"]);
    const csv=[headers,...rows].map(r=>r.map(x=>'"'+String(x).replace(/"/g,'""')+'"').join(",")).join("\n");
    const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([csv],{type:"text/csv"}));a.download=`late_${month}.csv`;a.click();
  };

  const scopeLabel=isAdmin?"All employees":isDirector?"Your departments":"Your team";

  return(
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Late Arrival Report</h1>
          <p className="text-gray-500 text-sm mt-1">{scopeLabel} · grouped by employee</p>
        </div>
        <button onClick={exportCSV} className="bg-green-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-green-700">CSV ↓</button>
      </div>
      <div className="bg-white rounded-2xl border border-gray-100 p-5 mb-6 flex items-end gap-4 flex-wrap">
        <div><label className="block text-sm font-semibold text-gray-600 mb-1.5">Month</label>
          <input type="month" value={month} onChange={e=>setMonth(e.target.value)} className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
        <div className="flex-1 min-w-40"><label className="block text-sm font-semibold text-gray-600 mb-1.5">Search employee</label>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Name..." className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/></div>
        <button onClick={loadData} className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700">Load</button>
      </div>
      <div className="grid grid-cols-4 gap-3 mb-5">
        {[{l:"Total Late",v:enriched.length,c:"bg-orange-100 text-orange-700"},{l:"Pending",v:pending,c:"bg-amber-100 text-amber-700"},{l:"Excused",v:excused,c:"bg-green-100 text-green-700"},{l:"Unexcused",v:unexcused,c:"bg-red-100 text-red-700"}].map(s=>(
          <div key={s.l} className={`${s.c} rounded-xl p-4 text-center`}><p className="text-2xl font-bold">{s.v}</p><p className="text-xs font-semibold mt-1">{s.l}</p></div>
        ))}
      </div>
      <div className="flex gap-2 mb-5">
        {(["all","pending","excused","unexcused"] as const).map(f=>(
          <button key={f} onClick={()=>setFilter(f)} className={`px-4 py-2 rounded-xl text-sm font-semibold capitalize transition-colors ${filter===f?f==="pending"?"bg-amber-500 text-white":f==="excused"?"bg-green-600 text-white":f==="unexcused"?"bg-red-600 text-white":"bg-blue-600 text-white":"bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            {f==="all"?`All (${enriched.length})`:f==="pending"?`Pending (${pending})`:f==="excused"?`Excused (${excused})`:`Unexcused (${unexcused})`}
          </button>
        ))}
        <p className="ml-auto text-sm text-gray-400 self-center">{groups.length} employee{groups.length!==1?"s":""}</p>
      </div>
      {loading?<div className="space-y-3">{[1,2,3].map(i=><div key={i} className="bg-white rounded-2xl border h-16 animate-pulse"/>)}</div>
      :groups.length===0?<div className="text-center py-16 text-gray-400"><p className="text-3xl mb-2">✅</p><p className="text-sm">No late records found.</p></div>
      :<div>{groups.map(g=><EmployeeGroup key={g.userId} group={g} filter={filter}/>)}</div>}
    </div>
  );
}
