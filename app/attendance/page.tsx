"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";

interface AttendanceRecord {
  id: string;
  userId: string;
  userName: string;
  type: string;
  status: string;
  punchInTime?: any;
  punchOutTime?: any;
  durationMinutes?: number;
  lateStatus?: string;
  lateMinutes?: number;
  lateApproved?: boolean | null;
  fieldDaySummary?: string;
  dateStr?: string;
  department?: string;
}

interface CheckInRecord {
  id: string;
  userId: string;
  userName: string;
  subType: string;
  clientName?: string;
  siteName?: string;
  checkInTime?: any;
  checkOutTime?: any;
  status: string;
}

const fmt = (ts: any) => {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const statusBadge = (status: string) => {
  const map: Record<string, string> = {
    approved: "bg-green-100 text-green-700",
    rejected: "bg-red-100 text-red-700",
    pending:  "bg-amber-100 text-amber-700",
    absent:   "bg-red-100 text-red-700",
  };
  return map[status] ?? "bg-gray-100 text-gray-600";
};

export default function AttendancePage() {
  const { isAdmin, isManager } = useAuth();
  const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
  const [checkins, setCheckins]     = useState<CheckInRecord[]>([]);
  const [loading, setLoading]       = useState(true);
  const [tab, setTab]               = useState<"attendance"|"checkins">("attendance");
  const [search, setSearch]         = useState("");
  const [filterStatus, setFilterStatus] = useState("");

  const today = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
      const [attSnap, ciSnap] = await Promise.all([
        getDocs(query(collection(db, "attendance"), where("timestamp", ">=", startOfDay))),
        getDocs(query(collection(db, "checkins"), where("timestamp", ">=", startOfDay))),
      ]);
      setAttendance(attSnap.docs.map(d => ({ id: d.id, ...d.data() } as AttendanceRecord)));
      setCheckins(ciSnap.docs.map(d => ({ id: d.id, ...d.data() } as CheckInRecord)));
    } finally { setLoading(false); }
  };

  const filteredAtt = attendance.filter(a => {
    const q = search.toLowerCase();
    const matchS = !q || a.userName.toLowerCase().includes(q);
    const matchSt = !filterStatus || a.status === filterStatus || a.type === filterStatus;
    return matchS && matchSt;
  });

  const filteredCI = checkins.filter(c => {
    const q = search.toLowerCase();
    return !q || c.userName.toLowerCase().includes(q);
  });

  const present    = attendance.filter(a => a.type === "punch-in").length;
  const absent     = attendance.filter(a => a.type === "absent").length;
  const fieldDays  = attendance.filter(a => a.type === "field-day").length;
  const lateCount  = attendance.filter(a => a.lateStatus === "late").length;
  const activeCI   = checkins.filter(c => !c.checkOutTime).length;

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Live Attendance</h1>
          <p className="text-gray-500 text-sm mt-1">{new Date().toLocaleDateString("en-PK", { weekday:"long", year:"numeric", month:"long", day:"numeric" })}</p>
        </div>
        <button onClick={loadData} className="text-sm text-blue-600 border border-blue-200 px-4 py-2 rounded-xl hover:bg-blue-50 font-semibold">
          Refresh ↻
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-5 gap-3 mb-6">
        {[
          { label:"Present",   value:present,   color:"bg-green-100 text-green-700" },
          { label:"Absent",    value:absent,     color:"bg-red-100 text-red-700" },
          { label:"Field Day", value:fieldDays,  color:"bg-blue-100 text-blue-700" },
          { label:"Late",      value:lateCount,  color:"bg-orange-100 text-orange-700" },
          { label:"Out Now",   value:activeCI,   color:"bg-purple-100 text-purple-700" },
        ].map(s => (
          <div key={s.label} className={`${s.color} rounded-xl p-3 text-center`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs font-semibold mt-0.5">{s.label}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4">
        {(["attendance","checkins"] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-5 py-2 rounded-xl text-sm font-semibold capitalize transition-colors ${
              tab===t ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}>
            {t==="attendance" ? `Attendance (${attendance.length})` : `Check-ins (${checkins.length})`}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search employee..."
          className="flex-1 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {tab==="attendance" && (
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}
            className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">All status</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="absent">Absent</option>
            <option value="field-day">Field Day</option>
          </select>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Loading...</div>
        ) : tab === "attendance" ? (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {["Employee","Type","Punch In","Punch Out","Duration","Late","Status"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredAtt.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-10 text-center text-gray-400 text-sm">No records for today.</td></tr>
                ) : filteredAtt.map(a => (
                  <tr key={a.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <p className="text-sm font-semibold text-gray-800">{a.userName}</p>
                      {a.department && <p className="text-xs text-gray-400">{a.department}</p>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                        a.type==="punch-in"?"bg-blue-100 text-blue-700":
                        a.type==="field-day"?"bg-purple-100 text-purple-700":
                        "bg-red-100 text-red-700"
                      }`}>
                        {a.type==="punch-in"?"Punch In":a.type==="field-day"?"Field Day":"Absent"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{fmt(a.punchInTime)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{fmt(a.punchOutTime)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {a.durationMinutes ? `${Math.floor(a.durationMinutes/60)}h ${a.durationMinutes%60}m` : "—"}
                    </td>
                    <td className="px-4 py-3">
                      {a.lateStatus==="late" ? (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                          a.lateApproved===true?"bg-green-100 text-green-700":
                          a.lateApproved===false?"bg-red-100 text-red-700":
                          "bg-orange-100 text-orange-700"
                        }`}>
                          {a.lateMinutes}m {a.lateApproved===true?"excused":a.lateApproved===false?"unexcused":"late"}
                        </span>
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge(a.status)}`}>
                        {a.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {["Employee","Type","Client / Site","Check In","Check Out","Status"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredCI.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">No check-ins today.</td></tr>
                ) : filteredCI.map(c => (
                  <tr key={c.id} className="border-b border-gray-50 hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-semibold text-gray-800">{c.userName}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${c.subType==="outer-visit"?"bg-orange-100 text-orange-700":"bg-blue-100 text-blue-700"}`}>
                        {c.subType==="outer-visit"?"🚗 Outer Visit":"📍 Other Site"}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600">{c.clientName ?? c.siteName ?? "—"}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{fmt(c.checkInTime)}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">
                      {c.checkOutTime ? fmt(c.checkOutTime) : <span className="text-green-600 font-semibold text-xs">Active</span>}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${statusBadge(c.status)}`}>{c.status}</span>
                    </td>
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
