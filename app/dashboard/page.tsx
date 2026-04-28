"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import { getTeamMembersForManager, getDirectorMembers } from "@/lib/team-utils";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";

// ── Trend chart for dashboard ──────────────────────────────────────────────────
function TrendChart({ isAdmin, isDirector, user }: { isAdmin:boolean; isDirector:boolean; user:any }) {
  const [period, setPeriod]   = useState<"week"|"month">("month");
  const [users, setUsers]     = useState<{id:string;name:string}[]>([]);
  const [selectedUser, setSelectedUser] = useState<string>("all");
  const [data, setData]       = useState<any[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(()=>{
    const loadUsers = async () => {
      try {
        let memberIds: string[] | null = null;
        // For non-admin/non-HR, scope to team — but only if user is loaded
        if (!isAdmin && user) {
          const m = isDirector ? await getDirectorMembers(user.uid, db) : await getTeamMembersForManager(user.uid, db);
          memberIds = m.map((x:any)=>x.id);
        } else if (!isAdmin && !user) {
          // Non-admin without user yet — skip loading until user arrives
          return;
        }
        const snap = await getDocs(collection(db,"users"));
        let list = snap.docs.map(d=>{
          const x = d.data() as any;
          // Try every possible name field — covers all the variations seen in Firestore
          const candidates = [
            x.name, x.displayName, x.fullName, x.userName, x.firstName,
            (x.firstName && x.lastName) ? `${x.firstName} ${x.lastName}` : null,
          ];
          let name = "";
          for (const c of candidates) {
            if (typeof c === "string" && c.trim()) { name = c.trim(); break; }
          }
          if (!name && typeof x.email === "string" && x.email.includes("@")) {
            name = x.email.split("@")[0];
          }
          if (!name) name = d.id.slice(0,8);
          return { id: d.id, name };
        });
        if (memberIds) list = list.filter(u=>memberIds!.includes(u.id));
        // De-dup just in case
        const uniq = new Map<string,{id:string;name:string}>();
        list.forEach(u => { if (!uniq.has(u.id)) uniq.set(u.id, u); });
        const sorted = Array.from(uniq.values()).sort((a,b)=>a.name.localeCompare(b.name));
        console.log("[TrendChart] Loaded", sorted.length, "users for dropdown:", sorted.map(u=>u.name).slice(0,5));
        setUsers(sorted);
      } catch (e) {
        console.error("[TrendChart] Failed to load users for chart:", e);
      }
    };
    loadUsers();
  },[isAdmin, isDirector, user]);

  useEffect(()=>{
    const loadData = async () => {
      setLoading(true);
      try {
        const days = period === "week" ? 7 : 30;
        const today = new Date();
        const startDate = new Date(today);
        startDate.setDate(startDate.getDate() - days + 1);
        startDate.setHours(0,0,0,0);
        const startStr = `${startDate.getFullYear()}-${String(startDate.getMonth()+1).padStart(2,"0")}-${String(startDate.getDate()).padStart(2,"0")}`;
        const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

        // Fetch attendance + checkins
        const [attTsSnap, attDsSnap, ciSnap] = await Promise.all([
          getDocs(query(collection(db,"attendance"), where("timestamp",">=",startDate))),
          getDocs(query(collection(db,"attendance"), where("dateStr",">=",startStr), where("dateStr","<=",todayStr))),
          getDocs(query(collection(db,"checkins"), where("timestamp",">=",startDate))),
        ]);

        // Merge attendance dual-query
        const seen = new Set<string>();
        const allAtt: any[] = [];
        attTsSnap.docs.forEach(d => {
          const r = d.data() as any;
          if (r.type !== "absent" && r.type !== "field-day") {
            if(!seen.has(d.id)){seen.add(d.id); allAtt.push({id:d.id, ...r});}
          }
        });
        attDsSnap.docs.forEach(d => {
          if(!seen.has(d.id)){seen.add(d.id); allAtt.push({id:d.id, ...d.data()});}
        });
        const allCi = ciSnap.docs.map(d=>({id:d.id, ...d.data()} as any));

        // Filter by selected user if applicable
        const userFilter = (r:any) => selectedUser === "all" || r.userId === selectedUser;
        const att = allAtt.filter(userFilter);
        const ci  = allCi.filter(userFilter);

        // Build per-day map
        const dayMap = new Map<string,{date:string; lates:number; absents:number; outerVisits:number; siteVisits:number}>();
        for(let i=0;i<days;i++){
          const d = new Date(startDate);
          d.setDate(d.getDate()+i);
          const ds = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
          const label = period === "week"
            ? d.toLocaleDateString("en-US",{weekday:"short", day:"numeric"})
            : `${d.getMonth()+1}/${d.getDate()}`;
          dayMap.set(ds, { date: label, lates:0, absents:0, outerVisits:0, siteVisits:0 });
        }

        // Count lates and absents from attendance
        att.forEach(r => {
          let ds = r.dateStr;
          if (!ds && r.timestamp?.toDate) {
            const t = r.timestamp.toDate();
            ds = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;
          }
          const slot = dayMap.get(ds);
          if (!slot) return;
          if (r.lateStatus === "late" && r.type === "punch-in") slot.lates++;
          if (r.type === "absent") slot.absents++;
        });

        // Count check-ins by type
        ci.forEach(r => {
          if (!r.checkInTime?.toDate) return;
          const t = r.checkInTime.toDate();
          const ds = `${t.getFullYear()}-${String(t.getMonth()+1).padStart(2,"0")}-${String(t.getDate()).padStart(2,"0")}`;
          const slot = dayMap.get(ds);
          if (!slot) return;
          if (r.subType === "outer-visit" || r.subType === "outer") slot.outerVisits++;
          else slot.siteVisits++;
        });

        setData(Array.from(dayMap.values()));
      } catch(e:any) {
        console.error("trend load error:", e);
      } finally { setLoading(false); }
    };
    loadData();
  },[period, selectedUser]);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
      <div className="flex justify-between items-center mb-4 flex-wrap gap-3">
        <h2 className="text-base font-bold text-gray-800">Activity trends</h2>
        <div className="flex gap-2 items-center flex-wrap">
          {/* User filter */}
          <select value={selectedUser} onChange={e=>setSelectedUser(e.target.value)}
            className="border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="all">All employees ({users.length})</option>
            {users.length === 0 ? <option disabled>Loading users…</option> : null}
            {users.map(u=><option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          {/* Period toggle */}
          <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
            {(["week","month"] as const).map(p=>(
              <button key={p} onClick={()=>setPeriod(p)}
                className={`px-3 py-1 rounded-md text-xs font-semibold transition ${period===p?"bg-white text-gray-800 shadow-sm":"text-gray-500"}`}>
                {p === "week" ? "7 days" : "30 days"}
              </button>
            ))}
          </div>
        </div>
      </div>
      {loading ? (
        <div className="h-72 flex items-center justify-center text-gray-400 text-sm">Loading...</div>
      ) : (
        <div className="h-72">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{top:5,right:20,left:0,bottom:5}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0"/>
              <XAxis dataKey="date" tick={{fontSize:11,fill:"#666"}} interval={period==="month"?2:0}/>
              <YAxis tick={{fontSize:11,fill:"#666"}} allowDecimals={false}/>
              <Tooltip contentStyle={{fontSize:12, borderRadius:8, border:"1px solid #e5e7eb"}}/>
              <Legend wrapperStyle={{fontSize:12}}/>
              <Line type="monotone" dataKey="lates"       stroke="#f59e0b" strokeWidth={2} name="🕐 Lates"          dot={{r:3}}/>
              <Line type="monotone" dataKey="absents"     stroke="#ef4444" strokeWidth={2} name="❌ Absents"        dot={{r:3}}/>
              <Line type="monotone" dataKey="siteVisits"  stroke="#3b82f6" strokeWidth={2} name="📍 Site Visits"    dot={{r:3}}/>
              <Line type="monotone" dataKey="outerVisits" stroke="#8b5cf6" strokeWidth={2} name="🚗 Outer Visits"   dot={{r:3}}/>
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

interface Stats {
  totalUsers:number; presentToday:number; absentToday:number;
  pendingApprovals:number; lateToday:number; activeCheckIns:number;
}

function StatCard({ label, value, icon, color, sub }: {
  label:string; value:number|string; icon:string; color:string; sub?:string;
}) {
  return (
    <div className="bg-white rounded-2xl p-6 border border-gray-100 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-gray-500 font-medium">{label}</p>
          <p className={`text-3xl font-bold mt-1 ${color}`}>{value}</p>
          {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
        </div>
        <span className="text-2xl">{icon}</span>
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { profile, isAdmin, isManager, isDirector, user } = useAuth();
  const [stats, setStats]   = useState<Stats|null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { if(user) loadStats(); }, [user, isAdmin, isDirector]);

  const loadStats = async () => {
    setLoading(true);
    try {
      const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
      const todayStr = (() => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })();

      // Step 1: determine which user IDs this viewer can see
      let memberUids: string[] = [];
      if (!isAdmin && user) {
        const members = isDirector
          ? await getDirectorMembers(user.uid, db)
          : await getTeamMembersForManager(user.uid, db);
        memberUids = members.map((m:any) => m.id);
      }

      // Step 2: fetch raw data
      // For attendance: query by timestamp (punch-ins) AND by dateStr=today (absent/field-day)
      const [usersSnap, attTsSnap, attDsSnap, ciSnap] = await Promise.all([
        getDocs(query(collection(db,"users"), where("device.approved","==",true))),
        getDocs(query(collection(db,"attendance"), where("timestamp",">=",startOfDay))),
        getDocs(query(collection(db,"attendance"), where("dateStr","==",todayStr))),
        getDocs(query(collection(db,"checkins"),   where("timestamp",">=",startOfDay))),
      ]);

      // Merge attendance: punch-ins from timestamp query, absent/field-day ONLY from dateStr query
      const seen = new Set<string>();
      let att: any[] = [];
      attTsSnap.docs.forEach(d => {
        const r = d.data() as any;
        if (r.type !== "absent" && r.type !== "field-day") {
          if(!seen.has(d.id)){seen.add(d.id); att.push({id:d.id, ...r});}
        }
      });
      attDsSnap.docs.forEach(d => {
        if(!seen.has(d.id)){seen.add(d.id); att.push({id:d.id, ...d.data()} as any);}
      });

      let ci  = ciSnap.docs.map(d=>({id:d.id,...d.data()} as any));
      let allUsers = usersSnap.docs.map(d=>({id:d.id,...d.data()} as any));

      // Step 3: filter to team members for non-admins
      if (!isAdmin && memberUids.length > 0) {
        att      = att.filter((a:any)      => memberUids.includes(a.userId));
        ci       = ci.filter((c:any)       => memberUids.includes(c.userId));
        allUsers = allUsers.filter((u:any) => memberUids.includes(u.id));
      }

      setStats({
        totalUsers:       isAdmin ? usersSnap.size : allUsers.length,
        presentToday:     att.filter(a=>a.type==="punch-in").length,
        absentToday:      att.filter(a=>a.type==="absent").length,
        pendingApprovals: [...att.filter(a=>a.status==="pending"||a.status==="absent"), ...ci.filter(c=>c.status==="pending")].length,
        lateToday:        att.filter(a=>a.lateStatus==="late").length,
        activeCheckIns:   ci.filter(c=>!c.checkOutTime&&c.status!=="rejected").length,
      });
    } catch(e) { console.error("Dashboard error:", e); }
    finally { setLoading(false); }
  };

  const greeting = () => {
    const h = new Date().getHours();
    return h<12?"Good morning":h<17?"Good afternoon":"Good evening";
  };

  const viewLabel = isAdmin?"All employees":isDirector?"Your departments":"Your team";

  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">
          {greeting()}, {profile?.name ?? profile?.email?.split("@")[0]} 👋
        </h1>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <p className="text-gray-500">
            {new Date().toLocaleDateString("en-PK",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}
          </p>
          <span className={`text-xs font-semibold px-2.5 py-0.5 rounded-full ${
            isAdmin?"bg-red-100 text-red-700":isDirector?"bg-purple-100 text-purple-700":"bg-blue-100 text-blue-700"
          }`}>
            {viewLabel}
          </span>
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {Array.from({length:6}).map((_,i)=>(
            <div key={i} className="bg-white rounded-2xl p-6 border border-gray-100 animate-pulse h-28"/>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          <StatCard label="Present Today"     value={stats?.presentToday??0}     icon="✅" color="text-green-600"  sub="Punched in today"/>
          <StatCard label="Absent Today"      value={stats?.absentToday??0}      icon="❌" color="text-red-600"    sub="No punch-in"/>
          <StatCard label="Pending Approvals" value={stats?.pendingApprovals??0} icon="⏳" color="text-amber-600"  sub="Needs your review"/>
          <StatCard label="Late Arrivals"     value={stats?.lateToday??0}        icon="🕐" color="text-orange-600" sub="After grace period"/>
          <StatCard label="Active Check-ins"  value={stats?.activeCheckIns??0}   icon="🚗" color="text-blue-600"   sub="Currently out"/>
          <StatCard
            label={isAdmin?"Total Employees":isDirector?"Dept employees":"Team members"}
            value={stats?.totalUsers??0} icon="👤" color="text-gray-700"
            sub={isAdmin?"Approved devices":isDirector?"Across your departments":"In your department"}
          />
        </div>
      )}

      {/* Trend chart */}
      <TrendChart isAdmin={isAdmin} isDirector={isDirector} user={user} />

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <h2 className="text-base font-bold text-gray-800 mb-4">Quick actions</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            {href:"/attendance",      label:"Live Attendance",icon:"📋",color:"bg-blue-50 text-blue-700 hover:bg-blue-100"},
            {href:"/approvals",       label:"Approvals",      icon:"✅",color:"bg-amber-50 text-amber-700 hover:bg-amber-100"},
            {href:"/reports/daily",   label:"Daily Report",   icon:"📅",color:"bg-green-50 text-green-700 hover:bg-green-100"},
            {href:"/reports/monthly", label:"Monthly Report", icon:"🗓️",color:"bg-purple-50 text-purple-700 hover:bg-purple-100"},
            ...(isAdmin?[
              {href:"/users",         label:"Manage Users",   icon:"👤",color:"bg-gray-50 text-gray-700 hover:bg-gray-100"},
              {href:"/devices",       label:"Device Approvals",icon:"📱",color:"bg-teal-50 text-teal-700 hover:bg-teal-100"},
            ]:[]),
          ].map(item=>(
            <a key={item.href} href={item.href}
              className={`flex flex-col items-center gap-2 p-4 rounded-xl text-sm font-semibold transition-colors cursor-pointer ${item.color}`}>
              <span className="text-2xl">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}
