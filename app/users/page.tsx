"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { collection, getDocs, doc, updateDoc, addDoc, serverTimestamp, query, where } from "firebase/firestore";
import { createUserWithEmailAndPassword, getAuth, sendPasswordResetEmail } from "firebase/auth";
import { initializeApp, getApps } from "firebase/app";
import { db, auth } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Modal from "@/components/ui/Modal";

const ALL_ROLES = ["employee","manager","director","hr","admin"];

// Secondary Firebase app — creates users without signing out the admin
const getSecondaryAuth = () => {
  const app = getApps().find(a => a.name === "secondary")
    ?? initializeApp(auth.app.options, "secondary");
  return getAuth(app);
};

interface UserRecord {
  id: string; email: string; name?: string;
  role: string | string[]; department?: string;
  designation?: string; employeeId?: string; employeeType?: "office" | "field"; allowFieldWork?: boolean;
  blocked?: boolean;
  device?: { deviceId?: string; approved?: boolean };
}

const getRoles = (u: UserRecord): string[] => {
  const r = u.role;
  if (Array.isArray(r)) return r;
  return (r ?? "employee").split(",").map((x: string) => x.trim());
};

function Badge({ text, color }: { text: string; color: string }) {
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-semibold ${color}`}>{text}</span>;
}

// ── Edit User Modal ───────────────────────────────────────────────────────────
function EditUserModal({ user, deptList, onClose, onSaved }: {
  user: UserRecord; deptList: {id:string;name:string}[];
  onClose: () => void; onSaved: () => void;
}) {
  const [name, setName]           = useState(user.name ?? "");
  const [dept, setDept]           = useState(user.department ?? "");
  const [designation, setDesig]   = useState(user.designation ?? "");
  const [employeeId, setEmpId]    = useState(user.employeeId ?? "");
  const [roles, setRoles]         = useState<string[]>(getRoles(user));
  const [joiningDate, setJoining] = useState<string>((user as any).joiningDate ?? "");
  const [empType, setEmpType]     = useState<"office"|"field">((user as any).employeeType ?? "office");
  const [allowField, setAllowField] = useState<boolean>((user as any).allowFieldWork ?? false);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");

  const toggleRole = (r: string) =>
    setRoles(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);

  const handleSave = async () => {
    if (!name.trim()) { setError("Name is required."); return; }
    if (!roles.length) { setError("Select at least one role."); return; }
    setSaving(true); setError("");
    try {
      await updateDoc(doc(db, "users", user.id), {
        name:        name.trim(),
        department:  dept || null,
        designation: designation.trim() || null,
        employeeType: empType,
        allowFieldWork: empType === "office" ? allowField : false, // only office staff can be hybrid
        joiningDate: joiningDate || null,
        employeeId:  employeeId.trim() || null,
        role:        roles.length === 1 ? roles[0] : roles,
        updatedAt:   serverTimestamp(),
      });
      onSaved(); onClose();
    } catch(e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title={`Edit — ${user.name ?? user.email}`} onClose={onClose}>
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Full Name *</label>
            <input value={name} onChange={e => setName(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Employee ID</label>
            <input value={employeeId} onChange={e => setEmpId(e.target.value)} placeholder="EMP-001"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Designation</label>
            <input value={designation} onChange={e => setDesig(e.target.value)} placeholder="e.g. Engineer"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Joining Date *</label>
            <input type="date" value={joiningDate} onChange={e=>setJoining(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 mt-1">Absent marking starts from this date</p>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Department</label>
            <select value={dept} onChange={e => setDept(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">No department</option>
              {deptList.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-2">Roles *</label>
          <div className="flex flex-wrap gap-2">
            {ALL_ROLES.map(r => (
              <button key={r} type="button" onClick={() => toggleRole(r)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors capitalize ${
                  roles.includes(r) ? "bg-blue-600 text-white border-blue-600" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}>
                {r}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">Select all that apply</p>
        </div>

        {/* Employee Type */}
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-2">Employee Type</label>
          <div className="flex gap-3">
            {([["office","🏢 Office Staff"],["field","🚗 Field Staff"]] as [string,string][]).map(([v,l])=>(
              <button key={v} type="button" onClick={()=>setEmpType(v as "office"|"field")}
                className={`flex-1 px-4 py-3 rounded-xl text-sm font-semibold border transition-colors ${empType===v?"bg-blue-600 text-white border-blue-600":"border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                {l}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">Field staff: travel time credited, auto-approved check-ins, measured by daily hours target</p>
          {/* Hybrid checkbox — only for office staff */}
          {empType === "office" && (
            <label className="flex items-start gap-2 mt-3 p-3 bg-blue-50 border border-blue-100 rounded-xl cursor-pointer">
              <input type="checkbox" checked={allowField} onChange={e=>setAllowField(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-blue-600"/>
              <div>
                <p className="text-sm font-semibold text-blue-800">Allow field work (occasional)</p>
                <p className="text-xs text-blue-600 mt-0.5">
                  For office staff who occasionally do client/market visits.
                  On days they check-in at sites, field staff rules apply (travel credited, no late penalty).
                  On office-only days, normal office rules apply.
                </p>
              </div>
            </label>
          )}
        </div>

        {error && <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300">
            {saving ? "Saving..." : "Save Changes"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── User Row ──────────────────────────────────────────────────────────────────
function UserRow({ user, onUpdate, deptList }: {
  user: UserRecord; onUpdate: () => void; deptList: {id:string;name:string}[];
}) {
  const [showEdit, setShowEdit] = useState(false);
  const [saving, setSaving]     = useState(false);

  const approved  = user.device?.approved === true;
  const blocked   = user.blocked === true;
  const roles     = getRoles(user);
  const deptName  = deptList.find(d => d.id === user.department)?.name ?? user.department ?? "—";

  const handleApproveDevice = async () => {
    await updateDoc(doc(db, "users", user.id), { "device.approved": true });
    onUpdate();
  };

  const handleRevokeDevice = async () => {
    if (!confirm(`Revoke device for ${user.name ?? user.email}?

They will be logged out and must register their device again on next login.`)) return;
    await updateDoc(doc(db, "users", user.id), {
      "device.approved":      false,
      "device.deviceId":      null,
      "device.brand":         null,
      "device.modelName":     null,
      "device.registeredAt":  null,
      "device.revokedAt":     new Date().toISOString(),
    });
    onUpdate();
  };

  const handlePasswordReset = async () => {
    if (!confirm(`Send password reset email to ${user.email}?`)) return;
    try {
      await sendPasswordResetEmail(auth, user.email);
      alert(`Password reset email sent to ${user.email}`);
    } catch(e: any) { alert(e.message); }
  };

  const handleToggleBlock = async () => {
    const action = blocked ? "Unblock" : "Block";
    const msg = blocked
      ? `Unblock ${user.name ?? user.email}? They will be able to log into the app again.`
      : `Block ${user.name ?? user.email}? They will be immediately logged out and cannot use the app.`;
    if (!confirm(msg)) return;
    setSaving(true);
    try {
      await updateDoc(doc(db, "users", user.id), {
        blocked: !blocked,
        "device.approved": blocked ? user.device?.approved ?? false : false,
      });
      onUpdate();
    } catch(e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  return (
    <>
      <tr className={`border-b border-gray-100 hover:bg-gray-50 ${blocked ? "opacity-60" : ""}`}>
        {/* Employee */}
        <td className="px-4 py-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm text-gray-800">{user.name ?? "—"}</p>
              {blocked && <Badge text="Blocked" color="bg-red-100 text-red-600" />}
            </div>
            {user.employeeId && <p className="text-xs text-blue-500 font-mono">{user.employeeId}</p>}
            {user.designation && <p className="text-xs text-gray-500 italic">{user.designation}</p>}
            {((user as any).employeeType === "field" || (user as any).allowFieldWork) && (
              <span className="text-xs font-bold bg-green-100 text-green-700 px-2 py-0.5 rounded-full">🚗 Field Staff</span>
            )}
            <p className="text-xs text-gray-400">{user.email}</p>
          </div>
        </td>

        {/* Role */}
        <td className="px-4 py-3">
          <div className="flex flex-wrap gap-1">
            {roles.map(r => (
              <Badge key={r} text={r} color={
                r==="admin"    ? "bg-red-100 text-red-700" :
                r==="director" ? "bg-orange-100 text-orange-700" :
                r==="manager"  ? "bg-blue-100 text-blue-700" :
                r==="hr"       ? "bg-purple-100 text-purple-700" :
                "bg-gray-100 text-gray-600"
              }/>
            ))}
          </div>
        </td>

        {/* Department */}
        <td className="px-4 py-3 text-sm text-gray-600">{deptName}</td>

        {/* Device */}
        <td className="px-4 py-3">
          {!user.device?.deviceId ? (
            <Badge text="No device" color="bg-gray-100 text-gray-500" />
          ) : approved ? (
            <Badge text="Approved" color="bg-green-100 text-green-700" />
          ) : (
            <Badge text="Pending" color="bg-amber-100 text-amber-700" />
          )}
        </td>

        {/* Actions */}
        <td className="px-4 py-3">
          <div className="flex gap-2 flex-wrap items-center">
            {!approved && user.device?.deviceId && (
              <button onClick={handleApproveDevice}
                className="text-xs bg-green-600 text-white px-3 py-1.5 rounded-lg hover:bg-green-700 font-semibold">
                Approve
              </button>
            )}
            {approved && !blocked && (
              <button onClick={handleRevokeDevice}
                className="text-xs bg-gray-50 text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-100 font-semibold">
                Revoke Device
              </button>
            )}
            <button onClick={handlePasswordReset}
              className="text-xs bg-purple-50 text-purple-600 border border-purple-200 px-3 py-1.5 rounded-lg hover:bg-purple-100 font-semibold">
              Reset Password
            </button>
            <button onClick={handleToggleBlock} disabled={saving}
              className={`text-xs px-3 py-1.5 rounded-lg font-semibold border transition-colors ${
                blocked
                  ? "bg-green-50 text-green-600 border-green-200 hover:bg-green-100"
                  : "bg-red-50 text-red-600 border-red-200 hover:bg-red-100"
              }`}>
              {saving ? "..." : blocked ? "Unblock" : "Block"}
            </button>
            <button onClick={() => setShowEdit(true)}
              className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-100 font-semibold">
              Edit
            </button>
          </div>
        </td>
      </tr>

      {showEdit && (
        <EditUserModal
          user={user} deptList={deptList}
          onClose={() => setShowEdit(false)}
          onSaved={onUpdate}
        />
      )}
    </>
  );
}

// ── Add User Modal ────────────────────────────────────────────────────────────
function AddUserModal({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const [name, setName]           = useState("");
  const [email, setEmail]         = useState("");
  const [password, setPassword]   = useState("");
  const [dept, setDept]           = useState("");
  const [designation, setDesig]   = useState("");
  const [employeeId, setEmpId]    = useState("");
  const [empType, setEmpType]     = useState<"office"|"field">("office");
  const [allowField, setAllowField] = useState<boolean>(false);
  const [roles, setRoles]         = useState<string[]>(["employee"]);
  const [joiningDate, setJoining] = useState(() => new Date().toISOString().split("T")[0]);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");
  const [depts, setDepts]         = useState<{id:string;name:string}[]>([]);

  useEffect(() => {
    getDocs(query(collection(db,"departments"), where("active","==",true)))
      .then(snap => setDepts(snap.docs.map(d => ({id:d.id, name:(d.data() as any).name}))))
      .catch(() => {});
  }, []);

  const toggleRole = (r: string) =>
    setRoles(prev => prev.includes(r) ? prev.filter(x => x !== r) : [...prev, r]);

  const handleAdd = async () => {
    if (!name.trim()) { setError("Name is required."); return; }
    if (!email.trim()) { setError("Email is required."); return; }
    if (password.length < 6) { setError("Password must be at least 6 characters."); return; }
    if (!roles.length) { setError("Select at least one role."); return; }
    setSaving(true); setError("");
    try {
      const secondaryAuth = getSecondaryAuth();
      const { user } = await createUserWithEmailAndPassword(secondaryAuth, email.trim().toLowerCase(), password);
      await secondaryAuth.signOut();
      const { setDoc } = await import("firebase/firestore");
      await setDoc(doc(db, "users", user.uid), {
        email:       email.trim().toLowerCase(),
        name:        name.trim(),
        role:        roles.length === 1 ? roles[0] : roles,
        department:  dept || null,
        designation: designation.trim() || null,
        employeeType: empType,
        employeeId:  employeeId.trim() || null,
        blocked:     false,
        device:      { deviceId: null, approved: false },
        joiningDate: joiningDate || new Date().toISOString().split("T")[0],
        createdAt:   serverTimestamp(),
      });
      onAdded(); onClose();
    } catch(e: any) {
      setError(e.code === "auth/email-already-in-use" ? "An account with this email already exists." : e.message);
    } finally { setSaving(false); }
  };

  return (
    <Modal title="Add New Employee" onClose={onClose} maxWidth="max-w-xl">
      <div className="p-6 space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Full Name *</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Ali Hassan"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Employee ID</label>
            <input value={employeeId} onChange={e => setEmpId(e.target.value)} placeholder="EMP-001"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Designation</label>
            <input value={designation} onChange={e => setDesig(e.target.value)} placeholder="e.g. Engineer"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Email Address *</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="ali@company.com"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Password * (min 6 characters)</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Set initial password"
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Joining Date *</label>
            <input type="date" value={joiningDate} onChange={e=>setJoining(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            <p className="text-xs text-gray-400 mt-1">Absent marking starts from this date</p>
          </div>
          <div className="col-span-2">
            <label className="block text-sm font-semibold text-gray-600 mb-1.5">Department</label>
            <select value={dept} onChange={e => setDept(e.target.value)}
              className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Select department</option>
              {depts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-2">Roles *</label>
          <div className="flex flex-wrap gap-2">
            {ALL_ROLES.map(r => (
              <button key={r} type="button" onClick={() => toggleRole(r)}
                className={`px-3 py-1.5 rounded-lg text-sm font-semibold border transition-colors capitalize ${
                  roles.includes(r) ? "bg-blue-600 text-white border-blue-600" : "border-gray-200 text-gray-600 hover:bg-gray-50"
                }`}>
                {r}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">Select all that apply — e.g. employee + manager for a department head</p>
        </div>

        <div className="bg-amber-50 border border-amber-100 rounded-xl px-4 py-3 text-xs text-amber-700">
          ⚠️ After creation the employee logs in on the mobile app to register their device. You then approve the device from the Pending tab.
        </div>

        {/* Employee Type */}
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-2">Employee Type</label>
          <div className="flex gap-3">
            {([["office","🏢 Office Staff"],["field","🚗 Field Staff"]] as [string,string][]).map(([v,l])=>(
              <button key={v} type="button" onClick={()=>setEmpType(v as "office"|"field")}
                className={`flex-1 px-4 py-3 rounded-xl text-sm font-semibold border transition-colors ${empType===v?"bg-blue-600 text-white border-blue-600":"border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
                {l}
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-400 mt-1">Field staff: travel time credited, auto-approved check-ins, measured by daily hours target</p>
          {/* Hybrid checkbox — only for office staff */}
          {empType === "office" && (
            <label className="flex items-start gap-2 mt-3 p-3 bg-blue-50 border border-blue-100 rounded-xl cursor-pointer">
              <input type="checkbox" checked={allowField} onChange={e=>setAllowField(e.target.checked)}
                className="mt-0.5 w-4 h-4 rounded accent-blue-600"/>
              <div>
                <p className="text-sm font-semibold text-blue-800">Allow field work (occasional)</p>
                <p className="text-xs text-blue-600 mt-0.5">
                  For office staff who occasionally do client/market visits.
                  On days they check-in at sites, field staff rules apply (travel credited, no late penalty).
                  On office-only days, normal office rules apply.
                </p>
              </div>
            </label>
          )}
        </div>

        {error && <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}

        <div className="flex gap-3 pt-2">
          <button onClick={onClose}
            className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={handleAdd} disabled={saving}
            className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300">
            {saving ? "Creating..." : "Create Account"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function UsersPage() {
  const { isAdmin } = useAuth();

  const [users, setUsers]           = useState<UserRecord[]>([]);
  const [loading, setLoading]       = useState(true);
  const [search, setSearch]         = useState("");
  const [filterDept, setFilterDept] = useState("");
  const [filterRole, setFilterRole] = useState("");
  const [showAdd, setShowAdd]       = useState(false);
  const [tab, setTab]               = useState<"all"|"pending"|"blocked">("all");
  const [deptList, setDeptList]     = useState<{id:string;name:string}[]>([]);

  const loadUsers = async () => {
    setLoading(true);
    try {
      const [uSnap, dSnap] = await Promise.all([
        getDocs(collection(db, "users")),
        getDocs(query(collection(db,"departments"), where("active","==",true))),
      ]);
      setUsers(uSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserRecord)));
      setDeptList(dSnap.docs.map(d => ({ id: d.id, name: (d.data() as any).name })));
    } finally { setLoading(false); }
  };

  useEffect(() => { if (isAdmin) loadUsers(); }, [isAdmin]);

  if (!isAdmin) return <div className="p-8 text-center text-gray-400">Admin access required.</div>;

  const pendingDevices = users.filter(u => u.device?.deviceId && !u.device?.approved && !u.blocked);
  const blockedUsers   = users.filter(u => u.blocked === true);

  const baseList = tab === "pending" ? pendingDevices : tab === "blocked" ? blockedUsers : users;

  const filtered = baseList.filter(u => {
    const q = search.toLowerCase();
    const matchSearch = !q || (u.email.toLowerCase().includes(q) || (u.name ?? "").toLowerCase().includes(q));
    const matchDept   = !filterDept || u.department === filterDept;
    const matchRole   = !filterRole || getRoles(u).includes(filterRole);
    return matchSearch && matchDept && matchRole;
  });

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Users</h1>
          <p className="text-gray-500 text-sm mt-1">
            {users.length} total · {pendingDevices.length} pending approval · {blockedUsers.length} blocked
          </p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700">
          + Add Employee
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 flex-wrap">
        {([
          ["all",     `All (${users.length})`,                   ""],
          ["pending", `Pending Approval (${pendingDevices.length})`, pendingDevices.length > 0 ? "amber" : ""],
          ["blocked", `Blocked (${blockedUsers.length})`,         blockedUsers.length > 0 ? "red" : ""],
        ] as const).map(([v, l, accent]) => (
          <button key={v} onClick={() => setTab(v as any)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${
              tab === v
                ? accent === "amber" ? "bg-amber-500 text-white"
                  : accent === "red" ? "bg-red-500 text-white"
                  : "bg-blue-600 text-white"
                : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"
            }`}>
            {l}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-5 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search by name or email..."
          className="flex-1 min-w-48 border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <select value={filterDept} onChange={e => setFilterDept(e.target.value)}
          className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All departments</option>
          {deptList.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
        <select value={filterRole} onChange={e => setFilterRole(e.target.value)}
          className="border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All roles</option>
          {ALL_ROLES.map(r => <option key={r} value={r}>{r}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="p-12 text-center text-gray-400 text-sm">Loading users...</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  {["Employee","Role","Department","Device","Actions"].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-bold text-gray-500 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">No users found.</td></tr>
                ) : (
                  filtered.map(u => <UserRow key={u.id} user={u} onUpdate={loadUsers} deptList={deptList} />)
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {showAdd && <AddUserModal onClose={() => setShowAdd(false)} onAdded={loadUsers} />}
    </div>
  );
}
