"use client";
import { useEffect, useState } from "react";
import { collection, getDocs, addDoc, updateDoc, doc, serverTimestamp } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { useAuth } from "@/lib/auth-context";
import Modal from "@/components/ui/Modal";

interface Site {
  id: string; name: string; latitude: string; longitude: string;
  radius: number; active: boolean; siteCode?: string; hasMachine?: boolean;
}

const EMPTY_FORM = { name:"", latitude:"", longitude:"", radius:"100", siteCode:"", hasMachine:false };

function SiteCard({ site, onRefresh }: { site: Site; onRefresh: () => void }) {
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm]         = useState({
    name: site.name, latitude: site.latitude, longitude: site.longitude,
    radius: String(site.radius), siteCode: site.siteCode ?? "", hasMachine: site.hasMachine ?? false,
  });
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");

  const handleSave = async () => {
    if (!form.name.trim() || !form.latitude.trim() || !form.longitude.trim()) {
      setError("Name, latitude and longitude are required."); return;
    }
    setSaving(true); setError("");
    try {
      await updateDoc(doc(db, "locations", site.id), {
        name:       form.name.trim(),
        latitude:   form.latitude.trim(),
        longitude:  form.longitude.trim(),
        radius:     parseInt(form.radius) || 100,
        siteCode:   form.siteCode.trim() || null,
        hasMachine: form.hasMachine,
        updatedAt:  serverTimestamp(),
      });
      setShowEdit(false); onRefresh();
    } catch(e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  const handleDeactivate = async () => {
    if (!confirm(`Deactivate "${site.name}"? Employees won't be able to punch in here.`)) return;
    await updateDoc(doc(db, "locations", site.id), { active: false });
    onRefresh();
  };

  const handleToggleMachine = async () => {
    await updateDoc(doc(db, "locations", site.id), { hasMachine: !site.hasMachine });
    onRefresh();
  };

  return (
    <>
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-start gap-4">
          {/* Icon */}
          <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center text-2xl flex-shrink-0">
            📍
          </div>

          {/* Info */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-bold text-gray-800 text-base">{site.name}</span>
              {site.siteCode && (
                <span className="text-xs bg-gray-100 text-gray-500 font-bold px-2 py-0.5 rounded-full font-mono">
                  {site.siteCode}
                </span>
              )}
              {site.hasMachine && (
                <span className="text-xs bg-purple-100 text-purple-700 font-semibold px-2 py-0.5 rounded-full">
                  🖥️ Machine
                </span>
              )}
              <span className="text-xs bg-green-100 text-green-700 font-semibold px-2 py-0.5 rounded-full">
                Active
              </span>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mt-2 mb-3">
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400 font-semibold uppercase mb-0.5">Latitude</p>
                <p className="text-sm font-mono font-bold text-gray-700">{parseFloat(site.latitude).toFixed(6)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400 font-semibold uppercase mb-0.5">Longitude</p>
                <p className="text-sm font-mono font-bold text-gray-700">{parseFloat(site.longitude).toFixed(6)}</p>
              </div>
              <div className="bg-gray-50 rounded-lg px-3 py-2">
                <p className="text-xs text-gray-400 font-semibold uppercase mb-0.5">Radius</p>
                <p className="text-sm font-bold text-gray-700">{site.radius}m</p>
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-2 flex-wrap">
              <a
                href={`https://www.google.com/maps?q=${site.latitude},${site.longitude}`}
                target="_blank" rel="noopener"
                className="text-xs bg-blue-50 text-blue-600 border border-blue-200 px-3 py-1.5 rounded-lg hover:bg-blue-100 font-semibold"
              >
                View Map 🗺️
              </a>
              <button
                onClick={() => setShowEdit(true)}
                className="text-xs bg-gray-50 text-gray-600 border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-100 font-semibold"
              >
                Edit ✏️
              </button>
              <button
                onClick={handleToggleMachine}
                className={`text-xs border px-3 py-1.5 rounded-lg font-semibold ${
                  site.hasMachine
                    ? "bg-purple-50 text-purple-600 border-purple-200 hover:bg-purple-100"
                    : "bg-gray-50 text-gray-500 border-gray-200 hover:bg-gray-100"
                }`}
              >
                {site.hasMachine ? "Remove Machine" : "Has Machine"}
              </button>
              <button
                onClick={handleDeactivate}
                className="text-xs bg-red-50 text-red-600 border border-red-200 px-3 py-1.5 rounded-lg hover:bg-red-100 font-semibold"
              >
                Deactivate
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Edit Modal */}
      {showEdit && (
        <Modal title={`Edit — ${site.name}`} onClose={() => { setShowEdit(false); setError(""); }}>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Site Name *</label>
                <input value={form.name} onChange={e => setForm(f=>({...f,name:e.target.value}))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Site Code</label>
                <input value={form.siteCode} onChange={e=>setForm(f=>({...f,siteCode:e.target.value}))}
                  placeholder="e.g. L1, HO"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Radius (metres)</label>
                <input type="number" min={10} max={5000} value={form.radius} onChange={e=>setForm(f=>({...f,radius:e.target.value}))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Latitude *</label>
                <input value={form.latitude} onChange={e=>setForm(f=>({...f,latitude:e.target.value}))}
                  placeholder="e.g. 30.295300"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Longitude *</label>
                <input value={form.longitude} onChange={e=>setForm(f=>({...f,longitude:e.target.value}))}
                  placeholder="e.g. 71.556200"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <div className="flex items-center gap-3 bg-purple-50 rounded-xl px-4 py-3">
              <input type="checkbox" id="machineChk" checked={form.hasMachine}
                onChange={e=>setForm(f=>({...f,hasMachine:e.target.checked}))}
                className="w-4 h-4 text-purple-600 rounded" />
              <label htmlFor="machineChk" className="text-sm text-purple-700 font-medium cursor-pointer">
                Physical attendance machine installed at this site
              </label>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
              💡 To get coordinates: open Google Maps, right-click your location → copy the lat, lng shown.
              <br />Radius = how far from the GPS point an employee can be and still punch in (100m recommended).
            </div>

            {error && <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowEdit(false); setError(""); }}
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
      )}
    </>
  );
}

export default function SitesPage() {
  const { isAdmin } = useAuth();
  const [sites, setSites]       = useState<Site[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showAdd, setShowAdd]   = useState(false);
  const [form, setForm]         = useState(EMPTY_FORM);
  const [saving, setSaving]     = useState(false);
  const [error, setError]       = useState("");
  const { user } = useAuth();

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const snap = await getDocs(collection(db, "locations"));
      setSites(
        snap.docs
          .map(d => ({ id: d.id, ...d.data() } as Site))
          .filter(s => s.active !== false)
          .sort((a,b) => (a.siteCode ?? a.name).localeCompare(b.siteCode ?? b.name))
      );
    } finally { setLoading(false); }
  };

  const handleAdd = async () => {
    if (!form.name.trim() || !form.latitude.trim() || !form.longitude.trim()) {
      setError("Name, latitude and longitude are required."); return;
    }
    setSaving(true); setError("");
    try {
      await addDoc(collection(db, "locations"), {
        name:       form.name.trim(),
        latitude:   form.latitude.trim(),
        longitude:  form.longitude.trim(),
        radius:     parseInt(form.radius) || 100,
        siteCode:   form.siteCode.trim() || null,
        hasMachine: form.hasMachine,
        active:     true,
        createdBy:  user?.uid,
        createdAt:  serverTimestamp(),
      });
      setForm(EMPTY_FORM); setShowAdd(false); loadData();
    } catch(e: any) { setError(e.message); }
    finally { setSaving(false); }
  };

  if (!isAdmin) return <div className="p-8 text-center text-gray-400">Admin access required.</div>;

  return (
    <div className="p-8">
      <div className="flex justify-between items-start mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sites & Locations</h1>
          <p className="text-gray-500 text-sm mt-1">
            {sites.length} active site{sites.length !== 1 ? "s" : ""} — used for GPS punch-in validation
          </p>
        </div>
        <button onClick={() => setShowAdd(true)}
          className="bg-blue-600 text-white px-5 py-2.5 rounded-xl text-sm font-semibold hover:bg-blue-700">
          + Add Site
        </button>
      </div>

      {/* Info */}
      <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-6 flex gap-3">
        <span>ℹ️</span>
        <div className="text-sm text-blue-700">
          <p className="font-semibold mb-0.5">How sites work</p>
          <p>When an employee punches in, the app checks their GPS against all active sites. If they are within the radius of any site, the punch-in is allowed. Add all office locations, construction sites, and any other approved locations here.</p>
        </div>
      </div>

      {/* Sites list */}
      {loading ? (
        <div className="space-y-4">{[1,2,3].map(i=><div key={i} className="bg-white rounded-2xl border h-28 animate-pulse"/>)}</div>
      ) : sites.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-5xl mb-3">📍</p>
          <p className="font-medium">No sites yet</p>
          <p className="text-xs mt-1">Add your office locations — employees can only punch in within the site radius</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sites.map(s => <SiteCard key={s.id} site={s} onRefresh={loadData} />)}
        </div>
      )}

      {/* Add Site Modal */}
      {showAdd && (
        <Modal title="Add New Site" onClose={() => { setShowAdd(false); setError(""); setForm(EMPTY_FORM); }}>
          <div className="p-6 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2">
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Site Name *</label>
                <input value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}
                  placeholder="e.g. Head Office, Construction Site A"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Site Code</label>
                <input value={form.siteCode} onChange={e=>setForm(f=>({...f,siteCode:e.target.value}))}
                  placeholder="e.g. L1, HO, CS1"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Radius (metres)</label>
                <input type="number" min={10} max={5000} value={form.radius} onChange={e=>setForm(f=>({...f,radius:e.target.value}))}
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Latitude *</label>
                <input value={form.latitude} onChange={e=>setForm(f=>({...f,latitude:e.target.value}))}
                  placeholder="e.g. 30.295300"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-600 mb-1.5">Longitude *</label>
                <input value={form.longitude} onChange={e=>setForm(f=>({...f,longitude:e.target.value}))}
                  placeholder="e.g. 71.556200"
                  className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>

            <div className="flex items-center gap-3 bg-purple-50 rounded-xl px-4 py-3">
              <input type="checkbox" id="machineAdd" checked={form.hasMachine}
                onChange={e=>setForm(f=>({...f,hasMachine:e.target.checked}))}
                className="w-4 h-4 text-purple-600 rounded" />
              <label htmlFor="machineAdd" className="text-sm text-purple-700 font-medium cursor-pointer">
                Physical attendance machine installed at this site
              </label>
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 text-xs text-blue-700">
              💡 Open Google Maps → right-click your location → the first number is latitude, second is longitude.
              Recommended radius: 100m for offices, 200–500m for construction sites.
            </div>

            {error && <p className="text-red-600 text-xs bg-red-50 rounded-lg px-3 py-2">{error}</p>}

            <div className="flex gap-3 pt-2">
              <button onClick={() => { setShowAdd(false); setForm(EMPTY_FORM); setError(""); }}
                className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5 text-sm font-semibold hover:bg-gray-50">
                Cancel
              </button>
              <button onClick={handleAdd} disabled={saving}
                className="flex-1 bg-blue-600 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-blue-700 disabled:bg-blue-300">
                {saving ? "Adding..." : "Add Site"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
