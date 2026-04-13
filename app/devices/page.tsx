"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";

interface UserRecord {
  id:string; email:string; name?:string; designation?:string;
  department?:string; role:string|string[];
  device?:{ deviceId?:string; approved?:boolean };
}

export default function DevicesPage() {
  const { isAdmin } = useAuth();
  const [users, setUsers]     = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<"pending"|"approved"|"all">("pending");

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db,"users"));
      setUsers(snap.docs.map(d=>({id:d.id,...d.data()} as UserRecord))
        .filter(u => u.device?.deviceId)); // only users who registered a device
    } finally { setLoading(false); }
  };

  const approve = async (u: UserRecord) => {
    await updateDoc(doc(db,"users",u.id), { "device.approved": true });
    loadUsers();
  };

  const revoke = async (u: UserRecord) => {
    if(!confirm(`Revoke device for ${u.name??u.email}?`)) return;
    await updateDoc(doc(db,"users",u.id), { "device.approved":false, "device.deviceId":null });
    loadUsers();
  };

  if(!isAdmin) return <div className="p-8 text-center text-gray-400">Admin access required.</div>;

  const pending  = users.filter(u=>!u.device?.approved);
  const approved = users.filter(u=>u.device?.approved);
  const displayed = tab==="pending"?pending:tab==="approved"?approved:users;

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Device Approvals</h1>
          <p className="text-gray-500 text-sm mt-1">
            {pending.length} pending · {approved.length} approved
          </p>
        </div>
        <button onClick={loadUsers} className="text-sm text-blue-600 border border-blue-200 px-4 py-2 rounded-xl hover:bg-blue-50 font-semibold">Refresh ↻</button>
      </div>

      {pending.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-5 flex gap-2 items-center">
          <span className="text-amber-600 font-bold text-lg">⚠️</span>
          <p className="text-amber-700 text-sm font-medium">
            {pending.length} device{pending.length!==1?"s":""} waiting for approval. Employees cannot use the app until approved.
          </p>
        </div>
      )}

      <div className="flex gap-2 mb-5">
        {([
          ["pending",  `Pending (${pending.length})`],
          ["approved", `Approved (${approved.length})`],
          ["all",      `All (${users.length})`],
        ] as const).map(([v,l])=>(
          <button key={v} onClick={()=>setTab(v)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab===v
                ? v==="pending"?"bg-amber-500 text-white":"bg-blue-600 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}>{l}</button>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Loading...</div>
        ) : displayed.length===0 ? (
          <div className="p-12 text-center text-gray-400">
            <p className="text-3xl mb-2">📱</p>
            <p className="text-sm">{tab==="pending"?"No pending devices — all clear!":"No devices found."}</p>
          </div>
        ) : (
          <table className="w-full">
            <thead><tr className="bg-gray-50 border-b border-gray-100">
              {["Employee","Device ID","Status","Actions"].map(h=>(
                <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {displayed.map((u,i)=>(
                <tr key={u.id} className={`border-b border-gray-50 ${i%2===0?"":"bg-gray-50/50"}`}>
                  <td className="px-4 py-3">
                    <p className="text-sm font-semibold text-gray-800">{u.name??u.email}</p>
                    {u.designation&&<p className="text-xs text-gray-500 italic">{u.designation}</p>}
                    <p className="text-xs text-gray-400">{u.email}</p>
                  </td>
                  <td className="px-4 py-3">
                    <p className="text-xs font-mono text-gray-600 bg-gray-100 px-2 py-1 rounded">{u.device?.deviceId}</p>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${u.device?.approved?"bg-green-100 text-green-700":"bg-amber-100 text-amber-700"}`}>
                      {u.device?.approved?"Approved":"Pending"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {!u.device?.approved && (
                        <button onClick={()=>approve(u)}
                          className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 font-semibold">
                          Approve
                        </button>
                      )}
                      {u.device?.approved && (
                        <button onClick={()=>revoke(u)}
                          className="text-xs bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 font-semibold">
                          Revoke
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
