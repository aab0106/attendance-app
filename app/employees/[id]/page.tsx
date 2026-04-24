"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { doc, getDoc, collection, getDocs, query, where, orderBy } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { getTeamMembersForManager, getDirectorMembers } from "@/lib/team-utils";

const fmtTime = (ts:any) => { if(!ts) return "—"; const d=ts.toDate?ts.toDate():new Date(ts); return d.toLocaleTimeString([],{hour:"2-digit",minute:"2-digit"}); };
const fmtDate = (ts:any) => { if(!ts) return "—"; const d=ts.toDate?ts.toDate():new Date(ts); return d.toLocaleDateString([],{weekday:"short",month:"short",day:"numeric"}); };
const fmtHM   = (m:number) => `${Math.floor(m/60)}h ${m%60}m`;

export default function EmployeeProfilePage() {
  const { id } = useParams<{id:string}>();
  const router = useRouter();
  const { isAdmin, isDirector, user } = useAuth();

  const [employee, setEmployee] = useState<any>(null);
  const [deptName, setDeptName] = useState("");
  const [loading, setLoading]   = useState(true);
  const [allowed, setAllowed]   = useState(false);
  const [month, setMonth]       = useState(()=>new Date().toISOString().slice(0,7));
  const [attendance, setAttendance] = useState<any[]>([]);
  const [checkins, setCheckins]     = useState<any[]>([]);
  const [leaves, setLeaves]         = useState<any[]>([]);
  const [attLoading, setAttLoading] = useState(false);

  // Load employee doc + check access
  useEffect(()=>{
    if(!id||!user) return;
    const load = async () => {
      try {
        // Check scope
        let inScope = isAdmin;
        if(!isAdmin) {
          const members = isDirector
            ? await getDirectorMembers(user.uid, db)
            : await getTeamMembersForManager(user.uid, db);
          inScope = members.some((m:any)=>m.id===id);
        }
        setAllowed(inScope);
        if(!inScope) { setLoading(false); return; }

        // Load employee
        const snap = await getDoc(doc(db,"users",id));
        if(snap.exists()) {
          const data = snap.data();
          setEmployee({id:snap.id,...data});
          if(data.department) {
            getDoc(doc(db,"departments",data.department))
              .then(d=>{ if(d.exists()) setDeptName(d.data()?.name??""); })
              .catch(()=>{});
          }
        }
      } finally { setLoading(false); }
    };
    load();
  },[id,user,isAdmin,isDirector]);

  // Load attendance for selected month
  useEffect(()=>{
    if(!id||!allowed) return;
    const load = async () => {
      setAttLoading(true);
      try {
        const [y,m] = month.split("-").map(Number);
        const start = new Date(y,m-1,1); const end = new Date(y,m,1);
        const monthStartStr = `${y}-${String(m).padStart(2,"0")}-01`;
        const nextMon = m===12 ? 1 : m+1;
        const nextYr  = m===12 ? y+1 : y;
        const monthEndStr = `${nextYr}-${String(nextMon).padStart(2,"0")}-01`;

        const [attTsSnap,attDsSnap,ciSnap,lvSnap] = await Promise.all([
          getDocs(query(collection(db,"attendance"),where("userId","==",id),where("timestamp",">=",start),where("timestamp","<",end))),
          getDocs(query(collection(db,"attendance"),where("userId","==",id),where("dateStr",">=",monthStartStr),where("dateStr","<",monthEndStr))),
          getDocs(query(collection(db,"checkins"),where("userId","==",id),where("timestamp",">=",start),where("timestamp","<",end))),
          getDocs(query(collection(db,"leaves"),where("userId","==",id))),
        ]);
        // Merge: timestamp query without absent/field-day + dateStr query for those
        const seen = new Set<string>();
        const merged: any[] = [];
        attTsSnap.docs.forEach(d => {
          const r = d.data() as any;
          if (r.type !== "absent" && r.type !== "field-day") {
            if(!seen.has(d.id)){seen.add(d.id); merged.push({id:d.id, ...r});}
          }
        });
        attDsSnap.docs.forEach(d => {
          if(!seen.has(d.id)){seen.add(d.id); merged.push({id:d.id, ...d.data()});}
        });
        setAttendance(merged);
        setCheckins(ciSnap.docs.map(d=>({id:d.id,...d.data()})));
        setLeaves(lvSnap.docs.map(d=>({id:d.id,...d.data()})));
      } finally { setAttLoading(false); }
    };
    load();
  },[id,month,allowed]);

  if(loading) return <div className="p-8 text-center text-gray-400">Loading...</div>;
  if(!allowed) return <div className="p-8 text-center text-gray-400">You don't have access to this employee's profile.</div>;
  if(!employee) return <div className="p-8 text-center text-gray-400">Employee not found.</div>;

  const present     = attendance.filter(a=>a.type==="punch-in"&&a.status==="approved").length;
  const absent      = attendance.filter(a=>a.type==="absent").length;
  const late        = attendance.filter(a=>a.lateStatus==="late").length;
  const lateUnexc   = attendance.filter(a=>a.lateStatus==="late"&&a.lateApproved===false).length;
  const punchMins   = attendance.filter(a=>a.type==="punch-in").reduce((s:number,a:any)=>s+(a.durationMinutes??0),0);
  const ciMins      = checkins.reduce((s:number,c:any)=>s+(c.durationMinutes??0),0);
  const monthLeaves = leaves.filter(l=>l.status==="approved"&&l.fromDate?.startsWith(month));
  const initials    = (employee.name??employee.email??"?").split(" ").map((w:string)=>w[0]).join("").toUpperCase().slice(0,2);
  const roleArr     = Array.isArray(employee.role)?employee.role:[employee.role??"employee"];
  const roleStr     = roleArr.map((r:string)=>r.charAt(0).toUpperCase()+r.slice(1)).join(" · ");

  return (
    <div className="p-8">
      <button onClick={()=>router.back()} className="text-blue-600 text-sm font-semibold mb-6 flex items-center gap-1 hover:underline">
        ← Back
      </button>

      {/* Profile card */}
      <div className="bg-blue-50 border border-blue-100 rounded-2xl p-6 mb-6 flex items-center gap-5">
        <div className="w-16 h-16 rounded-full bg-blue-600 flex items-center justify-center text-white text-2xl font-bold flex-shrink-0">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold text-gray-900">{employee.name ?? employee.email}</h1>
          {employee.designation && <p className="text-gray-500 text-sm mt-0.5">{employee.designation}</p>}
          <div className="flex gap-2 mt-2 flex-wrap">
            <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2.5 py-0.5 rounded-full">{roleStr}</span>
            {deptName && <span className="text-xs font-semibold bg-gray-100 text-gray-600 px-2.5 py-0.5 rounded-full">{deptName}</span>}
            <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${employee.blocked?"bg-red-100 text-red-700":"bg-green-100 text-green-700"}`}>
              {employee.blocked?"Blocked":"Active"}
            </span>
          </div>
        </div>
        <div className="text-right text-sm text-gray-500 flex-shrink-0">
          {employee.employeeId && <p className="font-semibold text-gray-700">{employee.employeeId}</p>}
          {employee.joiningDate && <p>Joined: {employee.joiningDate}</p>}
          <p className="text-xs mt-1">Device: {employee.device?.approved?"Approved":"Pending"}</p>
        </div>
      </div>

      {/* Month picker */}
      <div className="flex items-center gap-4 mb-5">
        <label className="text-sm font-semibold text-gray-600">Month</label>
        <input type="month" value={month} onChange={e=>setMonth(e.target.value)}
          className="border border-gray-200 rounded-xl px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
      </div>

      {/* Stats */}
      {attLoading ? (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
          {[...Array(6)].map((_,i)=><div key={i} className="bg-white rounded-xl h-20 animate-pulse border"/>)}
        </div>
      ) : (
        <div className="grid grid-cols-3 md:grid-cols-6 gap-3 mb-6">
          {[
            {l:"Present",   v:present,   c:"text-green-600"},
            {l:"Absent",    v:absent,    c:"text-red-600"},
            {l:"Late",      v:late,      c:"text-orange-600"},
            {l:"Unexcused", v:lateUnexc, c:"text-red-700"},
            {l:"Punch hrs", v:fmtHM(punchMins), c:"text-blue-600"},
            {l:"Leave days",v:monthLeaves.reduce((s:number,l:any)=>s+(l.days??0),0), c:"text-purple-600"},
          ].map(s=>(
            <div key={s.l} className="bg-white rounded-xl border border-gray-100 p-3 text-center">
              <p className={`text-xl font-bold ${s.c}`}>{s.v}</p>
              <p className="text-xs text-gray-400 mt-0.5">{s.l}</p>
            </div>
          ))}
        </div>
      )}

      {/* Attendance records */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-6">
        <div className="bg-gray-50 px-5 py-3 border-b border-gray-100">
          <p className="text-sm font-bold text-gray-700">Attendance records — {new Date(month+"-01").toLocaleDateString([],{month:"long",year:"numeric"})}</p>
        </div>
        {attendance.length===0?(
          <p className="text-center text-gray-400 text-sm py-8">No attendance records this month</p>
        ):(
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-b">
              {["Date","Type","Status","Punch In","Punch Out","Duration","Late"].map(h=>(
                <th key={h} className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {attendance.map((a:any,i)=>(
                <tr key={a.id} className={`border-b border-gray-50 ${i%2===0?"":"bg-gray-50/50"}`}>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{fmtDate(a.timestamp)}</td>
                  <td className="px-4 py-2.5 text-xs font-semibold">{a.type}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${a.status==="approved"?"bg-green-100 text-green-700":a.status==="absent"?"bg-red-100 text-red-700":"bg-amber-100 text-amber-700"}`}>
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs font-mono">{fmtTime(a.punchInTime)}</td>
                  <td className="px-4 py-2.5 text-xs font-mono">{fmtTime(a.punchOutTime)}</td>
                  <td className="px-4 py-2.5 text-xs">{a.durationMinutes?fmtHM(a.durationMinutes):"—"}</td>
                  <td className="px-4 py-2.5 text-xs">{a.lateStatus==="late"?<span className="text-orange-600 font-semibold">{a.lateMinutes}m</span>:"—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Leave history */}
      {leaves.length>0&&(
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="bg-gray-50 px-5 py-3 border-b border-gray-100">
            <p className="text-sm font-bold text-gray-700">Leave history ({leaves.length} requests)</p>
          </div>
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-b">
              {["Type","From","To","Days","Status","Reason"].map(h=>(
                <th key={h} className="px-4 py-2.5 text-left text-xs font-bold text-gray-400 uppercase">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {leaves.map((l:any,i)=>(
                <tr key={l.id} className={`border-b border-gray-50 ${i%2===0?"":"bg-gray-50/50"}`}>
                  <td className="px-4 py-2.5 text-xs font-semibold">{l.leaveLabel??l.leaveType}</td>
                  <td className="px-4 py-2.5 text-xs">{l.fromDate}</td>
                  <td className="px-4 py-2.5 text-xs">{l.toDate}</td>
                  <td className="px-4 py-2.5 text-xs">{l.days}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${l.status==="approved"?"bg-green-100 text-green-700":l.status==="rejected"?"bg-red-100 text-red-700":"bg-amber-100 text-amber-700"}`}>
                      {l.status}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500 max-w-xs truncate">{l.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
