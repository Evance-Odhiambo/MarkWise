"use client";
import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Building2, MapPin, Plus, Pencil, Trash2,
  Search, X, AlertCircle, CheckCircle2, Loader2,
} from "lucide-react";

type Campus = {
  id: string;
  name: string;
  location: string | null;
  createdAt: string;
  _count?: {
    buildings: number;
  };
};

export default function CampusesPage() {
  const [campuses, setCampuses] = useState<Campus[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [selectedCampus, setSelectedCampus] = useState<Campus | null>(null);
  const [formData, setFormData] = useState({ name: "", location: "" });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  useEffect(() => {
    fetchCampuses();
  }, []);

  const fetchCampuses = async () => {
    try {
      setLoading(true);
      const response = await fetch("/api/admin/campuses", {
        credentials: "include",
      });
      if (response.ok) {
        const data = await response.json();
        setCampuses(data.campuses || []);
      }
    } catch (err) {
      console.error("Failed to fetch campuses:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.name.trim()) {
      setError("Campus name is required");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const response = await fetch("/api/admin/campuses", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: formData.name.trim(),
          location: formData.location.trim() || null,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setSuccess("Campus created successfully!");
        setShowAddModal(false);
        setFormData({ name: "", location: "" });
        fetchCampuses();
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.message || "Failed to create campus");
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCampus || !formData.name.trim()) {
      setError("Campus name is required");
      return;
    }

    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/campuses/${selectedCampus.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          name: formData.name.trim(),
          location: formData.location.trim() || null,
        }),
      });

      const data = await response.json();
      if (response.ok) {
        setSuccess("Campus updated successfully!");
        setShowEditModal(false);
        setSelectedCampus(null);
        setFormData({ name: "", location: "" });
        fetchCampuses();
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.message || "Failed to update campus");
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedCampus) return;

    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/campuses/${selectedCampus.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      const data = await response.json();
      if (response.ok) {
        setSuccess("Campus deleted successfully!");
        setShowDeleteModal(false);
        setSelectedCampus(null);
        fetchCampuses();
        setTimeout(() => setSuccess(""), 3000);
      } else {
        setError(data.message || "Failed to delete campus");
      }
    } catch (err) {
      setError("An error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  const openEditModal = (campus: Campus) => {
    setSelectedCampus(campus);
    setFormData({
      name: campus.name,
      location: campus.location || "",
    });
    setError("");
    setShowEditModal(true);
  };

  const openDeleteModal = (campus: Campus) => {
    setSelectedCampus(campus);
    setError("");
    setShowDeleteModal(true);
  };

  const filteredCampuses = campuses.filter(
    (campus) =>
      campus.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (campus.location && campus.location.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Campus Management</h1>
          <p className="mt-1 text-sm text-gray-500">
            Manage campuses across your institution
          </p>
        </div>
        <button
          onClick={() => {
            setFormData({ name: "", location: "" });
            setError("");
            setShowAddModal(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-indigo-500 transition-colors"
        >
          <Plus className="h-4 w-4" />
          Add Campus
        </button>
      </div>

      {/* Success Message */}
      <AnimatePresence>
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="flex items-center gap-2 rounded-lg bg-green-50 p-4 text-sm text-green-800 border border-green-200"
          >
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            {success}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Search campuses..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        />
      </div>

      {/* Campus Grid */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-indigo-600" />
        </div>
      ) : filteredCampuses.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-gray-300 p-12 text-center">
          <Building2 className="mx-auto h-12 w-12 text-gray-400" />
          <h3 className="mt-2 text-sm font-semibold text-gray-900">No campuses found</h3>
          <p className="mt-1 text-sm text-gray-500">
            {searchQuery
              ? "Try a different search query"
              : "Get started by adding your first campus"}
          </p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredCampuses.map((campus) => (
            <motion.div
              key={campus.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm hover:shadow-md transition-shadow"
            >
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-3">
                  <div className="rounded-lg bg-indigo-50 p-2">
                    <Building2 className="h-5 w-5 text-indigo-600" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-gray-900">{campus.name}</h3>
                    {campus.location && (
                      <div className="mt-1 flex items-center gap-1 text-sm text-gray-500">
                        <MapPin className="h-3 w-3" />
                        {campus.location}
                      </div>
                    )}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => openEditModal(campus)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-indigo-600 transition-colors"
                    title="Edit campus"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => openDeleteModal(campus)}
                    className="rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-red-600 transition-colors"
                    title="Delete campus"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              {campus._count && (
                <div className="mt-4 flex items-center gap-4 text-sm text-gray-600">
                  <span>{campus._count.buildings} building{campus._count.buildings !== 1 ? 's' : ''}</span>
                </div>
              )}
            </motion.div>
          ))}
        </div>
      )}

      {/* Add Modal */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Add New Campus</h2>
                <button
                  onClick={() => setShowAddModal(false)}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {error && (
                <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 border border-red-200">
                  <AlertCircle className="h-5 w-5 text-red-600" />
                  {error}
                </div>
              )}

              <form onSubmit={handleAdd} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Campus Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Main Campus"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Location (Optional)
                  </label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="e.g., Downtown, Nairobi"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowAddModal(false)}
                    className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                  >
                    {submitting ? "Creating..." : "Create Campus"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Edit Modal */}
      <AnimatePresence>
        {showEditModal && selectedCampus && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            >
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-semibold text-gray-900">Edit Campus</h2>
                <button
                  onClick={() => setShowEditModal(false)}
                  className="rounded p-1 text-gray-400 hover:bg-gray-100 transition-colors"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>

              {error && (
                <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 border border-red-200">
                  <AlertCircle className="h-5 w-5 text-red-600" />
                  {error}
                </div>
              )}

              <form onSubmit={handleEdit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Campus Name *
                  </label>
                  <input
                    type="text"
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g., Main Campus"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Location (Optional)
                  </label>
                  <input
                    type="text"
                    value={formData.location}
                    onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                    placeholder="e.g., Downtown, Nairobi"
                    className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
                  />
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    type="button"
                    onClick={() => setShowEditModal(false)}
                    className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="flex-1 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                  >
                    {submitting ? "Saving..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Delete Modal */}
      <AnimatePresence>
        {showDeleteModal && selectedCampus && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
            >
              <div className="flex items-center gap-3 mb-4">
                <div className="rounded-full bg-red-100 p-2">
                  <AlertCircle className="h-6 w-6 text-red-600" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900">Delete Campus</h2>
              </div>

              {error && (
                <div className="mb-4 flex items-center gap-2 rounded-lg bg-red-50 p-3 text-sm text-red-800 border border-red-200">
                  <AlertCircle className="h-5 w-5 text-red-600" />
                  {error}
                </div>
              )}

              <p className="text-sm text-gray-600 mb-6">
                Are you sure you want to delete <strong>{selectedCampus.name}</strong>? This action
                cannot be undone.
                {selectedCampus._count && selectedCampus._count.buildings > 0 && (
                  <span className="block mt-2 text-red-600">
                    This campus has {selectedCampus._count.buildings} building(s). You must delete
                    all buildings first.
                  </span>
                )}
              </p>

              <div className="flex gap-3">
                <button
                  onClick={() => setShowDeleteModal(false)}
                  className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleDelete}
                  disabled={submitting || (selectedCampus._count && selectedCampus._count.buildings > 0)}
                  className="flex-1 rounded-lg bg-red-600 px-4 py-2 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50 transition-colors"
                >
                  {submitting ? "Deleting..." : "Delete Campus"}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
