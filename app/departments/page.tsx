"use client";
import { useEffect, useState } from "react";
import {
  collection, getDocs, addDoc, updateDoc, doc,
  query, where, serverTimestamp
} from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Modal from "@/components/ui/Modal";

interface Department {
  id: string;
  name: string;
  parentDeptId: string | null;
  headIds: string[];
  directorIds: string[];
  mdIds: string[];
  active: boolean;
}
interface UserRecord {
  id: string; email: string; name?: string;
  role: string | string[]; designation?: string;
}

const getRoles = (u: UserRecord): string[] => {
  const r = u.role;
  if (Array.isArray(r)) return r;
  return (r ?? "employee").split(",").map((x: string) => x.trim());
};

function UserPill({ uid, users }: { uid: string; users: UserRecord[] }) {
  const u = users.find(x => x.id === uid);
  if (!u) return null;
  return (
    <span className="text-xs bg-blue-100 text-blue-700 font-semibold px-2.5 py-1 rounded-full">
      {u.name ?? u.email}
    </span>
  );
}

function DeptCard({
  dept, allDepts, allUsers, onRefresh
}: {
  dept: Department; allDepts: Department[];
  allUsers: UserRecord[]; onRefresh: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing]   = useState(false);
  const [form, setForm]         = useState({
    name: dept.name,
    parentDeptId: dept.parentDeptId ?? "",
    headIds: dept.headIds ?? [],
    directorIds: dept.directorIds ?? [],
    mdIds: dept.mdIds ?? [],
  });
  const [saving, setSaving]   = useState(false);
  const [headSearch, setHeadSearch] = useState("");

  const subDepts    = allDepts.filter(d => d.parentDeptId === dept.id);
  const managers    = allUsers; // ALL users can be assigned as head — no role restriction
  const directors   = allUsers.filter(u => getRoles(u).some(r => ["director","admin"].includes(r)));
  const mds         = allUsers.filter(u => getRoles(u).some(r => ["director","admin"].includes(r)));
  const parentDepts = allDepts.filter(d => d.id !== dept.id && !d.parentDeptId);

  const toggleId = (field: "headIds"|"directorIds"|"mdIds", uid: string) => {
    setForm(f => ({
      ...f,
      [field]: f[field].includes(uid)
        ? f[field].filter((x: string) => x !== uid)
        : [...f[field], uid]
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      // Save department
      await updateDoc(doc(db, "departments", dept.id), {
        name:        form.name.trim(),
        parentDeptId: form.parentDeptId || null,
        headIds:     form.headIds,
        directorIds: form.directorIds,
        mdIds:       form.mdIds,
        updatedAt:   serverTimestamp(),
      });

      // Auto-update roles on users:
      // Newly added heads → add "manager" role
      const prevHeads = dept.headIds ?? [];
      const newHeads  = form.headIds;
      const added     = newHeads.filter(uid => !prevHeads.includes(uid));
      const removed   = prevHeads.filter(uid => !newHeads.includes(uid));

      await Promise.all([
        // Add manager role to newly assigned heads
        ...added.map(async uid => {
          const u = allUsers.find(x => x.id === uid);
          if (!u) return;
          const roles = getRoles(u);
          if (!roles.includes("manager")) {
            const newRoles = [...roles, "manager"];
            await updateDoc(doc(db, "users", uid), {
              role: newRoles.length === 1 ? newRoles[0] : newRoles
            });
          }
        }),
        // Check if removed heads are still head of another dept before removing manager role
        ...removed.map(async uid => {
          // Check if this user is still a head in any other dept
          const stillHead = await getDocs(query(
            collection(db, "departments"),
            where("active", "==", true),
            where("headIds", "array-contains", uid)
          ));
          // Only remove manager role if not head of any dept
          if (stillHead.empty) {
            const u = allUsers.find(x => x.id === uid);
            if (!u) return;
            const roles = getRoles(u).filter(r => r !== "manager");
            await updateDoc(doc(db, "users", uid), {
              role: roles.length === 1 ? roles[0] : (roles.length === 0 ? "employee" : roles)
            });
          }
        }),
      ]);

      setEditing(false); onRefresh();
    } catch(e: any) { alert(e.message); }
    finally { setSaving(false); }
  };

  const handleDeactivate = async () => {
    if (!confirm(`Deactivate "${dept.name}"?`)) return;
    await updateDoc(doc(db, "departments", dept.id), { active: false });
    onRefresh();
  };

  const parent = allDepts.find(d => d.id === dept.parentDeptId);

  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Header row */}
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full flex items-center gap-4 p-5 text-left hover:bg-gray-50 transition-colors"
      >
        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-bold text-sm flex-shrink-0">
          {dept.name[0]}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="font-bold text-gray-800">{dept.name}</p>
            {parent && (
              <span className="text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded-full">
                under {parent.name}
              </span>
            )}
            {subDepts.length > 0 && (
              <span className="text-xs bg-purple-100 text-purple-600 px-2 py-0.5 rounded-full">
                {subDepts.length} sub-dept{subDepts.length > 1 ? "s" : ""}
              </span>
            )}
          </div>
          <p className="text-xs text-gray-400 mt-0.5">
            {(dept.headIds ?? []).length} head{(dept.headIds ?? []).length !== 1 ? "s" : ""} ·{" "}
            {(dept.directorIds ?? []).length} director{(dept.directorIds ?? []).length !== 1 ? "s" : ""}
            {(dept.mdIds ?? []).length > 0 ? ` · ${dept.mdIds.length} MD` : ""}
          </p>
        </div>
        <span className="text-gray-300 text-lg">{expanded ? "▲" : "▼"}</span>
      </button>

      {expanded && (
        <div className="px-5 pb-5 border-t border-gray-100">
          {!editing ? (
            <>
              {/* View mode */}
              <div className="mt-4 space-y-3">
                {[
                  { label: `Department Heads (${(dept.headIds??[]).length})`, ids: dept.headIds ?? [], color: "bg-blue-100 text-blue-700" },
                  { label: "Directors", ids: dept.directorIds ?? [], color: "bg-purple-100 text-purple-700" },
                  { label: "Managing Directors", ids: dept.mdIds ?? [], color: "bg-red-100 text-red-700" },
                ].map(row => (
                  <div key={row.label}>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5">{row.label}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {row.ids.length === 0
                        ? <span className="text-xs text-gray-300">None assigned</span>
                        : row.ids.map(uid => <UserPill key={uid} uid={uid} users={allUsers} />)}
                    </div>
                  </div>
                ))}
                {subDepts.length > 0 && (
                  <div>
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-wide mb-1.5">Sub-departments</p>
                    <div className="flex flex-wrap gap-1.5">
                      {subDepts.map(s => (
                        <span key={s.id} className="text-xs bg-gray-100 text-gray-600 font-medium px-2.5 py-1 rounded-full">{s.name}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setEditing(true)} className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-100 font-semibold">Edit</button>
                <button onClick={handleDeactivate} className="text-xs bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 font-semibold">Deactivate</button>
              </div>
            </>
          ) : (
            <>
              {/* Edit mode */}
              <div className="mt-4 space-y-4">
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">Department Name</label>
                  <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">Parent Department (optional)</label>
                  <select value={form.parentDeptId} onChange={e => setForm(f => ({...f, parentDeptId: e.target.value}))}
                    className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                    <option value="">None (top-level department)</option>
                    {parentDepts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                {[
                  { label: "Department Heads (any employee can be assigned)", field: "headIds" as const, pool: managers.filter(u => !headSearch || (u.name??u.email??"").toLowerCase().includes(headSearch.toLowerCase())) },
                  { label: "Directors", field: "directorIds" as const, pool: directors },
                  { label: "Managing Directors", field: "mdIds" as const, pool: mds },
                ].map(row => (
                  <div key={row.field}>
                    <label className="block text-xs font-bold text-gray-500 uppercase mb-1.5">{row.label}</label>
                    {row.field === "headIds" && (
                      <input value={headSearch} onChange={e=>setHeadSearch(e.target.value)}
                        placeholder="Search employee..."
                        className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-sm mb-1.5 focus:outline-none focus:ring-1 focus:ring-blue-400" />
                    )}
                    <div className="max-h-40 overflow-y-auto border border-gray-100 rounded-xl p-2 space-y-0.5">
                      {row.pool.map(u => (
                        <button key={u.id} type="button"
                          onClick={() => toggleId(row.field, u.id)}
                          className={`w-full text-left px-3 py-1.5 rounded-lg text-sm flex justify-between transition-colors ${form[row.field].includes(u.id) ? "bg-blue-50 text-blue-700 font-semibold" : "hover:bg-gray-50 text-gray-700"}`}>
                          <span>{u.name ?? u.email}</span>
                          {form[row.field].includes(u.id) && <span className="text-blue-600">✓</span>}
                        </button>
                      ))}
                      {row.pool.length === 0 && <p className="text-xs text-gray-400 px-3 py-2">No users with this role found.</p>}
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 mt-4">
                <button onClick={() => setEditing(false)} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2 text-sm font-semibold hover:bg-gray-50">Cancel</button>
                <button onClick={handleSave} disabled={saving} className="flex-1 bg-blue-600 text-white rounded-xl py-2 text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300">
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function CreateDeptModal({ allDepts, onClose, onCreate }: {
  allDepts: Department[]; onClose: () => void; onCreate: () => void;
}) {
  const { user } = useAuth();
  const [name, setName]           = useState("");
  const [parentId, setParentId]   = useState("");
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState("");

  const topLevel = allDepts.filter(d => !d.parentDeptId);

  const handleCreate = async () => {
    if (!name.trim()) { setError("Department name is required."); return; }
    setSaving(true); setError("");
    try {
      await addDoc(collection(db, "departments"), {
        name:        name.trim(),
        parentDeptId: parentId || null,
        headIds:     [],
        directorIds: [],
        mdIds:       [],
        active:      true,
        createdBy:   user?.uid,
        createdAt:   serverTimestamp(),
      });
      onCreate(); onClose();
    } catch(e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  return (
    <Modal title="New Department" onClose={onClose}>
      <div className="p-6 space-y-4">
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">Department Name *</label>
          <input value={name} onChange={e => setName(e.target.value)}
            placeholder="e.g. IT, Project Sales, Accounts & Finance"
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-semibold text-gray-600 mb-1.5">Parent Department (optional)</label>
          <select value={parentId} onChange={e => setParentId(e.target.value)}
            className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">None — this is a top-level department</option>
            {topLevel.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <p className="text-xs text-gray-400 mt-1">Sub-departments inherit the director from the parent department.</p>
        </div>
        {error && <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}
        <div className="flex gap-3 pt-2">
          <button onClick={onClose} className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50">Cancel</button>
          <button onClick={handleCreate} disabled={saving}
            className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300">
            {saving ? "Creating..." : "Create Department"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

export default function DepartmentsPage() {
  const { isAdmin } = useAuth();
  const [depts, setDepts]       = useState<Department[]>([]);
  const [allUsers, setAllUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [filter, setFilter]     = useState<"all"|"top"|"sub">("all");

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [dSnap, uSnap] = await Promise.all([
        getDocs(query(collection(db, "departments"), where("active", "==", true))),
        getDocs(collection(db, "users")),
      ]);
      setDepts(dSnap.docs.map(d => ({ id: d.id, ...d.data() } as Department)));
      setAllUsers(uSnap.docs.map(d => ({ id: d.id, ...d.data() } as UserRecord)));
    } finally { setLoading(false); }
  };

  if (!isAdmin) return <div className="p-8 text-center text-gray-400">Admin access required.</div>;

  const topLevel = depts.filter(d => !d.parentDeptId);
  const subDepts = depts.filter(d => !!d.parentDeptId);

  const displayed = filter === "top" ? topLevel : filter === "sub" ? subDepts : depts;

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Departments</h1>
          <p className="text-gray-500 text-sm mt-1">
            {topLevel.length} main · {subDepts.length} sub-departments
          </p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700">
          + New Department
        </button>
      </div>

      {/* How hierarchy works */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-6 flex gap-3">
        <span>🏢</span>
        <div className="text-sm text-blue-700">
          <p className="font-semibold mb-0.5">Department hierarchy</p>
          <p>Employee → approved by Department Head · Head → approved by Director · Director → approved by MD or Admin. Sub-departments inherit the director from their parent.</p>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-5">
        {([["all","All"],["top","Main Departments"],["sub","Sub-departments"]] as const).map(([v,l]) => (
          <button key={v} onClick={() => setFilter(v)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition-colors ${filter === v ? "bg-blue-600 text-white" : "bg-white border border-gray-200 text-gray-600 hover:bg-gray-50"}`}>
            {l}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="bg-white rounded-2xl border h-16 animate-pulse" />)}</div>
      ) : displayed.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-5xl mb-3">🏢</p>
          <p className="font-medium">No departments yet</p>
          <p className="text-xs mt-1">Create your company's department structure</p>
        </div>
      ) : (
        <div className="space-y-3">
          {displayed.map(d => (
            <DeptCard key={d.id} dept={d} allDepts={depts} allUsers={allUsers} onRefresh={loadData} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreateDeptModal allDepts={depts} onClose={() => setShowCreate(false)} onCreate={loadData} />
      )}
    </div>
  );
}
