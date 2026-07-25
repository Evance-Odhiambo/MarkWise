"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useFacilitiesManager } from "./context";
import { motion, AnimatePresence } from "framer-motion";

// Icons
import { 
  Building2, 
  Plus, 
  Search, 
  X, 
  Edit, 
  Trash2,
  ChevronDown,
  ChevronUp,
  Layers,
  DoorOpen,
  Users,
  Hash,
  CheckCircle2,
  Clock,
  AlertCircle,
  RefreshCw,
  Save,
  Zap,
  MapPin,
  Upload,
  Download,
  FileText,
  Sparkles,
  Timer,
  Calendar,
  Building
} from "lucide-react";

// ==================== TYPES ====================

type RoomStatus = "free" | "reserved" | "occupied" | "unavailable";

type ApiRoomResponse = {
  id: string;
  institutionId: string;
  buildingCode: string;
  roomCode: string;
  name: string;
  capacity: number;
  type: string;
  floor: number;
  status: RoomStatus;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  hasConflict?: boolean;
  bookingStartTime?: string;
  bookingEndTime?: string;
  bookingUnitCode?: string;
  bookingLecturerName?: string;
};

type Room = ApiRoomResponse & {
  buildingName?: string;
};

type RoomFormData = {
  institutionId: string;
  buildingCode: string;
  buildingName: string;
  roomCode: string;
  name: string;
  capacity: number;
  type: string;
  floor: number;
  status: RoomStatus;
  isActive: boolean;
};

type BulkRoomData = {
  buildingName: string;
  buildingCode: string;
  floor: number;
  roomPrefix: string;
  startNumber: number;
  endNumber: number;
  capacity: number;
  type: string;
  status: RoomStatus;
};

// ==================== CONSTANTS ====================

const STATUS_CONFIG = {
  free: {
    label: "Free",
    bgColor: "bg-emerald-100",
    textColor: "text-emerald-700",
    borderColor: "border-emerald-300",
    darkBg: "dark:bg-emerald-900/30",
    darkText: "dark:text-emerald-700",
    icon: <CheckCircle2 className="w-3 h-3" />
  },
  reserved: {
    label: "Reserved",
    bgColor: "bg-amber-100",
    textColor: "text-amber-700",
    borderColor: "border-amber-300",
    darkBg: "dark:bg-amber-900/30",
    darkText: "dark:text-amber-700",
    icon: <Clock className="w-3 h-3" />
  },
  occupied: {
    label: "Occupied",
    bgColor: "bg-rose-100",
    textColor: "text-rose-700",
    borderColor: "border-rose-300",
    darkBg: "dark:bg-rose-900/30",
    darkText: "dark:text-rose-700",
    icon: <Users className="w-3 h-3" />
  },
  unavailable: {
    label: "Unavailable",
    bgColor: "bg-slate-100",
    textColor: "text-slate-700",
    borderColor: "border-slate-300",
    darkBg: "dark:bg-gray-50",
    darkText: "dark:text-gray-700",
    icon: <X className="w-3 h-3" />
  }
};

const ROOM_TYPES = [
  { value: "lecture", label: "Lecture Hall", icon: "🎓" },
  { value: "lab", label: "Laboratory", icon: "🔬" },
  { value: "seminar", label: "Seminar Room", icon: "📚" },
  { value: "office", label: "Office", icon: "💼" },
  { value: "conference", label: "Conference Room", icon: "🤝" },
  { value: "study", label: "Study Room", icon: "📖" }
];

const FLOOR_LABELS: Record<number, string> = {
  0: "Ground Floor",
  1: "1st Floor",
  2: "2nd Floor",
  3: "3rd Floor",
  4: "4th Floor",
  5: "5th Floor"
};

// Initialize building names from localStorage or use defaults
const getInitialBuildingNames = (): Record<string, string> => {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem('buildingNames');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Failed to parse building names', e);
      }
    }
  }
  // Default building names
  return {
    "HRD": "Human Resource Development",
    "SCI": "Science Complex",
    "ENG": "Engineering Building",
    "LIB": "Central Library",
    "ADM": "Administration Block",
    "MED": "Medical School",
    "BUS": "Business School",
    "LAW": "Law Faculty",
    "CLB": "Common Lecture Building"
  };
};

// ==================== HELPER FUNCTIONS ====================

// Format time from ISO string to HH:MM
const formatTime = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
  } catch {
    return "Invalid time";
  }
};

// Calculate time remaining until a given time
const getTimeRemaining = (targetTime: string): string => {
  try {
    const now = new Date();
    const target = new Date(targetTime);
    const diffMs = target.getTime() - now.getTime();
    
    if (diffMs <= 0) return "Now";
    
    const diffMins = Math.floor(diffMs / 60000);
    
    if (diffMins < 60) {
      return `${diffMins} min${diffMins !== 1 ? 's' : ''}`;
    }
    
    const hours = Math.floor(diffMins / 60);
    const mins = diffMins % 60;
    
    if (mins === 0) {
      return `${hours} hour${hours !== 1 ? 's' : ''}`;
    }
    
    return `${hours}h ${mins}m`;
  } catch {
    return "Unknown";
  }
};

// ==================== COMPONENTS ====================

function StatCard({ title, value, icon, color }: { title: string; value: number; icon: React.ReactNode; color: string }) {
  return (
    <div className={`rounded-xl ${color} p-4 text-gray-900 shadow-lg border-2 border-white/20`}>
      <div className="flex items-center justify-between">
        <div className="p-2 bg-white/20 rounded-lg">
          {icon}
        </div>
        <span className="text-2xl font-bold">{value}</span>
      </div>
      <p className="mt-2 text-sm font-medium opacity-90">{title}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: RoomStatus }) {
  const config = STATUS_CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${config.bgColor} ${config.textColor} ${config.borderColor} ${config.darkBg} ${config.darkText}`}>
      {config.icon}
      {config.label}
    </span>
  );
}

function TimeDisplay({ room }: { room: Room }) {
  // Debug log to see what data we're receiving
  useEffect(() => {
    if (room.status === "reserved" || room.status === "occupied") {
      console.log(`📊 Room ${room.roomCode} (${room.status}) data:`, {
        bookingStartTime: room.bookingStartTime,
        bookingEndTime: room.bookingEndTime,
        bookingUnitCode: room.bookingUnitCode,
        bookingLecturerName: room.bookingLecturerName
      });
    }
  }, [room]);

  if (room.status === "reserved") {
    const timeRemaining = room.bookingEndTime ? getTimeRemaining(room.bookingEndTime) : "--";
    return (
      <div className="mt-2 pt-2 border-t border-amber-200 dark:border-amber-800">
        <div className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-600">
          <Timer className="w-3 h-3" />
          <span className="font-medium">Free in:</span>
          <span className="font-bold">{timeRemaining}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500 mt-1">
          <Calendar className="w-3 h-3" />
          <span>Until {room.bookingEndTime ? formatTime(room.bookingEndTime) : "--"}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-amber-700 dark:text-amber-600 mt-1">
          <span className="font-medium">Reserved:</span>
          <span>{room.bookingStartTime && room.bookingEndTime ? `${formatTime(room.bookingStartTime)} - ${formatTime(room.bookingEndTime)}` : "--"}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500 mt-1">
          <span className="font-medium">Unit:</span>
          <span>{room.bookingUnitCode || "--"}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-500 mt-1">
          <span className="font-medium">Lecturer:</span>
          <span>{room.bookingLecturerName || "--"}</span>
        </div>
      </div>
    );
  }
  
  if (room.status === "occupied") {
    if (!room.bookingEndTime) {
      return (
        <div className="mt-2 pt-2 border-t border-rose-200 dark:border-rose-800">
          <div className="flex items-center gap-1 text-xs text-rose-700 dark:text-rose-600">
            <Users className="w-3 h-3" />
            <span className="font-medium">Occupied</span>
            <span className="text-rose-500 dark:text-rose-500">(No booking details)</span>
          </div>
        </div>
      );
    }

    const timeRemaining = getTimeRemaining(room.bookingEndTime);
    return (
      <div className="mt-2 pt-2 border-t border-rose-200 dark:border-rose-800">
        <div className="flex items-center gap-1 text-xs text-rose-700 dark:text-rose-600">
          <Timer className="w-3 h-3" />
          <span className="font-medium">Free in:</span>
          <span className="font-bold">{timeRemaining}</span>
        </div>
        <div className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-500 mt-1">
          <Calendar className="w-3 h-3" />
          <span>Until {formatTime(room.bookingEndTime)}</span>
        </div>
        {room.bookingUnitCode && (
          <div className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-500 mt-1">
            <span className="font-medium">Current:</span>
            <span>{room.bookingUnitCode}</span>
          </div>
        )}
        {room.bookingLecturerName && (
          <div className="flex items-center gap-1 text-xs text-rose-600 dark:text-rose-500 mt-1">
            <span className="font-medium">Lecturer:</span>
            <span>{room.bookingLecturerName}</span>
          </div>
        )}
      </div>
    );
  }
  
  return null;
}

// Building Name Editor Modal Component
function BuildingNameEditor({ 
  isOpen, 
  onClose, 
  buildingNames, 
  onSave 
}: { 
  isOpen: boolean; 
  onClose: () => void; 
  buildingNames: Record<string, string>;
  onSave: (newNames: Record<string, string>) => void;
}) {
  const [editedNames, setEditedNames] = useState<Record<string, string>>({});

  useEffect(() => {
    if (isOpen) {
      setEditedNames({ ...buildingNames });
    }
  }, [isOpen, buildingNames]);

  const handleSave = () => {
    onSave(editedNames);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.9 }}
        animate={{ scale: 1 }}
        exit={{ scale: 0.9 }}
        className="bg-white rounded-xl p-6 max-w-lg w-full border-2 border-indigo-300 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 mb-4">
          <Building className="w-5 h-5 text-indigo-600" />
          <h2 className="text-xl font-bold">Edit Building Names</h2>
        </div>
        
        <p className="text-sm text-gray-500 dark:text-gray-500 mb-4">
          Set display names for building codes. These will be saved in your browser.
        </p>

        <div className="space-y-3 max-h-96 overflow-y-auto">
          {Object.entries(editedNames).sort().map(([code, name]) => (
            <div key={code} className="flex items-center gap-2">
              <span className="font-mono font-bold text-indigo-600 dark:text-indigo-600 w-20">
                {code}
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setEditedNames(prev => ({
                  ...prev,
                  [code]: e.target.value
                }))}
                className="flex-1 px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                placeholder="Building name"
              />
            </div>
          ))}
        </div>

        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2 border-2 border-slate-300 hover:bg-slate-100 dark:hover:bg-gray-100 rounded-lg font-semibold transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            className="flex-1 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-gray-900 rounded-lg font-semibold transition-colors border-2 border-indigo-600"
          >
            Save Names
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

// ==================== MAIN COMPONENT ====================

export default function FacilitiesManagerPage() {
  const router = useRouter();
  const manager = useFacilitiesManager();
  
  // State
  const [mounted, setMounted] = useState(false);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [search, setSearch] = useState("");
  const [selectedBuilding, setSelectedBuilding] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"single" | "bulk">("single");
  const [showForm, setShowForm] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState<Room | null>(null);
  const [expandedBuildings, setExpandedBuildings] = useState<Set<string>>(new Set());
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date());
  const [buildingNames, setBuildingNames] = useState<Record<string, string>>(getInitialBuildingNames());
  const [showBuildingEditor, setShowBuildingEditor] = useState(false);
  
  // Single room form state
  const [formData, setFormData] = useState<RoomFormData>({
    institutionId: "",
    buildingCode: "",
    buildingName: "",
    roomCode: "",
    name: "",
    capacity: 30,
    type: "lecture",
    floor: 0,
    status: "free",
    isActive: true
  });

  // Bulk room form state
  const [bulkFormData, setBulkFormData] = useState<BulkRoomData>({
    buildingName: "",
    buildingCode: "",
    floor: 0,
    roomPrefix: "",
    startNumber: 1,
    endNumber: 10,
    capacity: 30,
    type: "lecture",
    status: "free"
  });

  // Save building names to localStorage whenever they change
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('buildingNames', JSON.stringify(buildingNames));
    }
  }, [buildingNames]);

  // Handle client-side mounting to prevent hydration errors
  useEffect(() => {
    setMounted(true);
  }, []);

  // Auto-refresh every 30 seconds to update booking times
  useEffect(() => {
    const interval = setInterval(() => {
      loadRooms(true); // Silent refresh
    }, 30000);
    
    return () => clearInterval(interval);
  }, []);

  // Sync institutionId from auth context
  useEffect(() => {
    if (manager?.institutionId) {
      setFormData(prev => ({ ...prev, institutionId: manager.institutionId }));
    }
  }, [manager?.institutionId]);

  // Load rooms
  const loadRooms = async (silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    
    try {
      // Add limit to get all rooms; API defaults to today's bookings
      const response = await fetch("/api/rooms?limit=1000", { credentials: "include" });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to load rooms");
      }

      const loadedRooms = data.data?.rooms || [];
      
      // Enhance rooms with building names from our mapping
      const enhancedRooms = loadedRooms.map((room: ApiRoomResponse) => {
        // Get building name from our mapping, or use the building code as fallback
        const buildingName = buildingNames[room.buildingCode] || room.buildingCode;
        
        return {
          ...room,
          buildingName
        };
      });
      
      setRooms(enhancedRooms);
      setLastRefresh(new Date());
      
      // Auto-expand all buildings by default on first load
      if (!silent && enhancedRooms.length > 0) {
        const buildings = [...new Set(enhancedRooms.map((r: Room) => r.buildingCode))] as string[];
        setExpandedBuildings(new Set(buildings));
      }
    } catch (err: any) {
      if (!silent) setError(err.message);
      console.error("Failed to load rooms:", err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  useEffect(() => {
    loadRooms();
  }, []);

  // Also reload rooms when building names change to update display
  useEffect(() => {
    if (rooms.length > 0) {
      setRooms(prevRooms => 
        prevRooms.map(room => ({
          ...room,
          buildingName: buildingNames[room.buildingCode] || room.buildingCode
        }))
      );
    }
  }, [buildingNames]);

  // Save single room
  const handleSaveRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      const url = editingRoom ? `/api/rooms/${editingRoom.id}` : "/api/rooms";
      const method = editingRoom ? "PATCH" : "POST";

      // Save building name to our mapping
      if (formData.buildingName) {
        setBuildingNames(prev => ({
          ...prev,
          [formData.buildingCode]: formData.buildingName
        }));
      }

      // Prepare payload without buildingName (API doesn't expect it)
      const { buildingName, ...apiPayload } = formData;

      const response = await fetch(url, {
        method,
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(apiPayload)
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to save room");
      }

      setSuccess(editingRoom ? "Room updated successfully!" : "Room created successfully!");
      setShowForm(false);
      setEditingRoom(null);
      resetForm();
      loadRooms();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Bulk create rooms
  const handleBulkCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSuccess("");

    try {
      // Generate rooms
      const roomsToCreate = [];
      const { startNumber, endNumber, buildingCode, buildingName, floor, roomPrefix, capacity, type, status } = bulkFormData;
      
      // Save building name to our mapping
      if (buildingName) {
        setBuildingNames(prev => ({
          ...prev,
          [buildingCode]: buildingName
        }));
      }

      for (let i = startNumber; i <= endNumber; i++) {
        const roomNumber = i.toString().padStart(3, '0');
        const roomCode = roomPrefix 
          ? `${roomPrefix} ${roomNumber}`
          : `${buildingCode} ${roomNumber}`;
        
        roomsToCreate.push({
          institutionId: manager?.institutionId || formData.institutionId,
          buildingCode,
          roomCode,
          name: `${buildingName} Room ${roomNumber}`,
          capacity,
          type,
          floor,
          status,
          isActive: true
        });
      }

      // Send bulk request
      const response = await fetch("/api/rooms/bulk", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rooms: roomsToCreate })
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to create rooms");
      }

      setSuccess(`${roomsToCreate.length} rooms created successfully!`);
      setShowForm(false);
      loadRooms();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Delete room
  const handleDeleteRoom = async (room: Room) => {
    setSaving(true);
    setError("");

    try {
      const response = await fetch(`/api/rooms/${room.id}`, {
        method: "DELETE",
        credentials: "include",
      });

      if (!response.ok) {
        const data = await response.json();
        throw new Error(data.error?.message || "Failed to delete room");
      }

      setSuccess("Room deleted successfully!");
      setDeleteConfirm(null);
      loadRooms();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Edit room
  const handleEditRoom = (room: Room) => {
    setFormData({
      institutionId: room.institutionId,
      buildingCode: room.buildingCode,
      buildingName: room.buildingName || room.buildingCode,
      roomCode: room.roomCode,
      name: room.name,
      capacity: room.capacity,
      type: room.type,
      floor: room.floor,
      status: room.status,
      isActive: room.isActive
    });
    setEditingRoom(room);
    setShowForm(true);
    setActiveTab("single");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  // Reset forms
  const resetForm = () => {
    const institutionId = manager?.institutionId || formData.institutionId;
    setFormData({
      institutionId,
      buildingCode: "",
      buildingName: "",
      roomCode: "",
      name: "",
      capacity: 30,
      type: "lecture",
      floor: 0,
      status: "free",
      isActive: true
    });
    setBulkFormData({
      buildingName: "",
      buildingCode: "",
      floor: 0,
      roomPrefix: "",
      startNumber: 1,
      endNumber: 10,
      capacity: 30,
      type: "lecture",
      status: "free"
    });
    setEditingRoom(null);
  };

  // Toggle building expansion
  const toggleBuilding = (buildingCode: string) => {
    const newExpanded = new Set(expandedBuildings);
    if (newExpanded.has(buildingCode)) {
      newExpanded.delete(buildingCode);
    } else {
      newExpanded.add(buildingCode);
    }
    setExpandedBuildings(newExpanded);
  };

  // Expand all buildings
  const expandAll = () => {
    setExpandedBuildings(new Set([...new Set(rooms.map(r => r.buildingCode))]));
  };

  // Collapse all buildings
  const collapseAll = () => {
    setExpandedBuildings(new Set());
  };

  // Memoized derivations — avoid re-running on every render
  const { buildings, buildingOptions, filteredRooms, groupedRooms, stats } = useMemo(() => {
    const buildings = [...new Set(rooms.map(r => r.buildingCode))].sort();
    const buildingOptions = buildings.map(code => ({ code, name: buildingNames[code] || code }));

    const sq = search.toLowerCase();
    const filteredRooms = rooms.filter(room => {
      const matchesSearch = sq === "" ||
        room.roomCode.toLowerCase().includes(sq) ||
        room.name.toLowerCase().includes(sq) ||
        room.buildingCode.toLowerCase().includes(sq) ||
        (room.buildingName || "").toLowerCase().includes(sq) ||
        (room.bookingUnitCode || "").toLowerCase().includes(sq) ||
        (room.bookingLecturerName || "").toLowerCase().includes(sq);
      const matchesBuilding = selectedBuilding === "" || room.buildingCode === selectedBuilding;
      return matchesSearch && matchesBuilding;
    });

    // Group by building then floor in one pass
    const groupedRooms: Record<string, { buildingName: string; floors: Record<number, Room[]> }> = {};
    for (const room of filteredRooms) {
      if (!groupedRooms[room.buildingCode]) {
        groupedRooms[room.buildingCode] = { buildingName: buildingNames[room.buildingCode] || room.buildingCode, floors: {} };
      }
      const floor = room.floor;
      if (!groupedRooms[room.buildingCode].floors[floor]) groupedRooms[room.buildingCode].floors[floor] = [];
      groupedRooms[room.buildingCode].floors[floor].push(room);
    }
    // Sort floors
    for (const building of Object.keys(groupedRooms)) {
      const floors = groupedRooms[building].floors;
      groupedRooms[building].floors = Object.keys(floors)
        .map(Number).sort((a, b) => a - b)
        .reduce((acc, floor) => { acc[floor] = floors[floor]; return acc; }, {} as Record<number, Room[]>);
    }

    // Single pass for all stats instead of 5 separate filter passes
    const stats = { total: rooms.length, free: 0, reserved: 0, occupied: 0, unavailable: 0, buildings: buildings.length, totalCapacity: 0 };
    for (const r of rooms) {
      stats.totalCapacity += r.capacity;
      if (r.status === "free") stats.free++;
      else if (r.status === "reserved") stats.reserved++;
      else if (r.status === "occupied") stats.occupied++;
      else if (r.status === "unavailable") stats.unavailable++;
    }

    return { buildings, buildingOptions, filteredRooms, groupedRooms, stats };
  }, [rooms, search, selectedBuilding, buildingNames]);

  // Create a static timestamp for SSR that won't change
  const staticTimestamp = "Loading...";

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900">
      <div className="max-w-7xl mx-auto p-6 space-y-6">
        
        {/* Header */}
        <div className="bg-gradient-to-r from-indigo-600 to-purple-600 rounded-2xl p-8 text-gray-900 shadow-xl border-2 border-indigo-600">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="p-3 bg-white/20 rounded-xl border-2 border-white/30">
                <Building2 className="w-8 h-8" />
              </div>
              <div>
                <h1 className="text-3xl font-bold">Room Manager</h1>
                <p className="text-gray-700 mt-1">Room statuses for today &middot; {new Date().toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}</p>
              </div>
            </div>
            <button
              onClick={() => setShowBuildingEditor(true)}
              className="flex items-center gap-2 bg-white/20 hover:bg-white/30 px-4 py-2 rounded-lg transition-colors border-2 border-white/30"
              title="Edit building names"
            >
              <Building className="w-4 h-4" />
              <span className="text-sm">Edit Buildings</span>
            </button>
          </div>
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-600">
            <Clock className="w-4 h-4" />
            <span>Last updated: {mounted ? lastRefresh.toLocaleTimeString([], { 
              hour: '2-digit', 
              minute: '2-digit', 
              second: '2-digit',
              hour12: false 
            }) : staticTimestamp}</span>
            <button 
              onClick={() => loadRooms()}
              className="ml-2 p-1 hover:bg-white/20 rounded transition-colors"
              title="Refresh now"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
          <StatCard title="Total Rooms" value={stats.total} icon={<DoorOpen className="w-4 h-4" />} color="bg-indigo-600" />
          <StatCard title="Free" value={stats.free} icon={<CheckCircle2 className="w-4 h-4" />} color="bg-emerald-600" />
          <StatCard title="Reserved" value={stats.reserved} icon={<Clock className="w-4 h-4" />} color="bg-amber-600" />
          <StatCard title="Occupied" value={stats.occupied} icon={<Users className="w-4 h-4" />} color="bg-rose-600" />
          <StatCard title="Buildings" value={stats.buildings} icon={<Building2 className="w-4 h-4" />} color="bg-purple-600" />
          <StatCard title="Total Seats" value={stats.totalCapacity} icon={<Users className="w-4 h-4" />} color="bg-cyan-600" />
        </div>

        {/* Action Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl border-2 border-indigo-200 dark:border-indigo-800 shadow-md">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                resetForm();
                setShowForm(!showForm);
                setActiveTab("single");
              }}
              className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-gray-900 px-4 py-2 rounded-lg font-semibold transition-colors border-2 border-indigo-600 shadow-md"
            >
              <Plus className="w-4 h-4" />
              {showForm ? "Hide Form" : "Add Room"}
            </button>
            
            <button
              onClick={() => loadRooms()}
              className="p-2 hover:bg-slate-100 dark:hover:bg-gray-100 rounded-lg transition-colors border-2 border-slate-200"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            <div className="h-6 w-px bg-slate-300 dark:bg-slate-700 mx-2"></div>

            <button
              onClick={expandAll}
              className="text-sm px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-gray-100 rounded-lg transition-colors border border-slate-200"
            >
              Expand All
            </button>
            <button
              onClick={collapseAll}
              className="text-sm px-3 py-1.5 hover:bg-slate-100 dark:hover:bg-gray-100 rounded-lg transition-colors border border-slate-200"
            >
              Collapse All
            </button>
          </div>

          <div className="flex items-center gap-3 flex-1 max-w-md">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by room, building, lecturer, or unit..."
                className="w-full pl-10 pr-4 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2"
                >
                  <X className="w-4 h-4 text-gray-500 hover:text-gray-500" />
                </button>
              )}
            </div>

            <select
              value={selectedBuilding}
              onChange={(e) => setSelectedBuilding(e.target.value)}
              className="px-4 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none"
            >
              <option value="">All Buildings</option>
              {buildingOptions.map(({ code, name }) => (
                <option key={code} value={code}>{name} ({code})</option>
              ))}
            </select>
          </div>
        </div>

        {/* Form Section with Tabs */}
        <AnimatePresence>
          {showForm && (
            <motion.div
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="bg-white p-6 rounded-xl border-2 border-indigo-300 shadow-lg"
            >
              {/* Form Tabs */}
              <div className="flex gap-2 mb-6 border-b-2 border-slate-200 pb-2">
                <button
                  onClick={() => setActiveTab("single")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    activeTab === "single" 
                      ? "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-700 border-2 border-indigo-300" 
                      : "text-gray-500 dark:text-gray-500 hover:bg-slate-100 dark:hover:bg-gray-100"
                  }`}
                >
                  <Plus className="w-4 h-4" />
                  Single Room
                </button>
                <button
                  onClick={() => setActiveTab("bulk")}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors ${
                    activeTab === "bulk" 
                      ? "bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-700 border-2 border-indigo-300" 
                      : "text-gray-500 dark:text-gray-500 hover:bg-slate-100 dark:hover:bg-gray-100"
                  }`}
                >
                  <Zap className="w-4 h-4" />
                  Bulk Create
                </button>
              </div>

              {activeTab === "single" ? (
                // Single Room Form
                <form onSubmit={handleSaveRoom} className="space-y-4">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    {editingRoom ? <Edit className="w-5 h-5" /> : <Plus className="w-5 h-5" />}
                    {editingRoom ? "Edit Room" : "Create New Room"}
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Building Name</label>
                      <input
                        type="text"
                        value={formData.buildingName}
                        onChange={(e) => setFormData({ ...formData, buildingName: e.target.value })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                        placeholder="e.g., Human Resource Development"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Building Code</label>
                      <input
                        type="text"
                        value={formData.buildingCode}
                        onChange={(e) => setFormData({ ...formData, buildingCode: e.target.value.toUpperCase() })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                        placeholder="e.g., HRD"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Room Code</label>
                      <input
                        type="text"
                        value={formData.roomCode}
                        onChange={(e) => setFormData({ ...formData, roomCode: e.target.value })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                        placeholder="e.g., HRD 101"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Room Name</label>
                      <input
                        type="text"
                        value={formData.name}
                        onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                        placeholder="e.g., Main Lecture Hall"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Capacity</label>
                      <input
                        type="number"
                        value={formData.capacity}
                        onChange={(e) => setFormData({ ...formData, capacity: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                        min="1"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Room Type</label>
                      <select
                        value={formData.type}
                        onChange={(e) => setFormData({ ...formData, type: e.target.value })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                      >
                        {ROOM_TYPES.map(type => (
                          <option key={type.value} value={type.value}>
                            {type.icon} {type.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Floor</label>
                      <select
                        value={formData.floor}
                        onChange={(e) => setFormData({ ...formData, floor: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                      >
                        {Object.entries(FLOOR_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Status</label>
                      <select
                        value={formData.status}
                        onChange={(e) => setFormData({ ...formData, status: e.target.value as RoomStatus })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                      >
                        {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                          <option key={key} value={key}>{config.label}</option>
                        ))}
                      </select>
                    </div>

                    <div className="flex items-center">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={formData.isActive}
                          onChange={(e) => setFormData({ ...formData, isActive: e.target.checked })}
                          className="w-4 h-4 text-indigo-600 border-2 border-slate-300 rounded focus:ring-indigo-500"
                        />
                        <span className="text-sm font-medium">Active Room</span>
                      </label>
                    </div>
                  </div>

                  {error && (
                    <div className="p-3 bg-rose-50 border-2 border-rose-300 rounded-lg text-rose-700 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      {error}
                    </div>
                  )}

                  <div className="flex gap-3 pt-4">
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-gray-900 px-6 py-2 rounded-lg font-semibold transition-colors border-2 border-indigo-600 shadow-md disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Saving...
                        </>
                      ) : (
                        <>
                          <Save className="w-4 h-4" />
                          {editingRoom ? "Update Room" : "Create Room"}
                        </>
                      )}
                    </button>
                    
                    {editingRoom && (
                      <button
                        type="button"
                        onClick={() => {
                          resetForm();
                          setShowForm(false);
                        }}
                        className="px-6 py-2 border-2 border-slate-300 hover:bg-slate-100 dark:hover:bg-gray-100 rounded-lg font-semibold transition-colors"
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              ) : (
                // Bulk Create Form
                <form onSubmit={handleBulkCreate} className="space-y-4">
                  <h2 className="text-xl font-bold mb-4 flex items-center gap-2">
                    <Zap className="w-5 h-5" />
                    Bulk Create Rooms
                  </h2>
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    <div>
                      <label className="block text-sm font-medium mb-1">Building Name</label>
                      <input
                        type="text"
                        value={bulkFormData.buildingName}
                        onChange={(e) => setBulkFormData({ ...bulkFormData, buildingName: e.target.value })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                        placeholder="e.g., Human Resource Development"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Building Code</label>
                      <input
                        type="text"
                        value={bulkFormData.buildingCode}
                        onChange={(e) => setBulkFormData({ ...bulkFormData, buildingCode: e.target.value.toUpperCase() })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                        placeholder="e.g., HRD"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Room Prefix</label>
                      <input
                        type="text"
                        value={bulkFormData.roomPrefix}
                        onChange={(e) => setBulkFormData({ ...bulkFormData, roomPrefix: e.target.value })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                        placeholder="Leave empty to use building code"
                      />
                      <p className="text-xs text-gray-400 mt-1">Optional: Custom prefix for room codes</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Floor</label>
                      <select
                        value={bulkFormData.floor}
                        onChange={(e) => setBulkFormData({ ...bulkFormData, floor: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                      >
                        {Object.entries(FLOOR_LABELS).map(([value, label]) => (
                          <option key={value} value={value}>{label}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Start Number</label>
                      <input
                        type="number"
                        min="1"
                        value={bulkFormData.startNumber}
                        onChange={(e) => setBulkFormData({ ...bulkFormData, startNumber: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">End Number</label>
                      <input
                        type="number"
                        min="1"
                        value={bulkFormData.endNumber}
                        onChange={(e) => setBulkFormData({ ...bulkFormData, endNumber: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                        required
                      />
                      <p className="text-xs text-gray-400 mt-1">Will create {Math.max(0, bulkFormData.endNumber - bulkFormData.startNumber + 1)} rooms</p>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Capacity per Room</label>
                      <input
                        type="number"
                        min="1"
                        value={bulkFormData.capacity}
                        onChange={(e) => setBulkFormData({ ...bulkFormData, capacity: parseInt(e.target.value) })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                        required
                      />
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Room Type</label>
                      <select
                        value={bulkFormData.type}
                        onChange={(e) => setBulkFormData({ ...bulkFormData, type: e.target.value })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                      >
                        {ROOM_TYPES.map(type => (
                          <option key={type.value} value={type.value}>
                            {type.icon} {type.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-sm font-medium mb-1">Status</label>
                      <select
                        value={bulkFormData.status}
                        onChange={(e) => setBulkFormData({ ...bulkFormData, status: e.target.value as RoomStatus })}
                        className="w-full px-3 py-2 border-2 border-slate-200 rounded-lg bg-white focus:border-indigo-500 outline-none"
                      >
                        {Object.entries(STATUS_CONFIG).map(([key, config]) => (
                          <option key={key} value={key}>{config.label}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {error && (
                    <div className="p-3 bg-rose-50 border-2 border-rose-300 rounded-lg text-rose-700 flex items-center gap-2">
                      <AlertCircle className="w-4 h-4" />
                      {error}
                    </div>
                  )}

                  <div className="flex gap-3 pt-4">
                    <button
                      type="submit"
                      disabled={saving}
                      className="flex items-center gap-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-gray-900 px-6 py-2 rounded-lg font-semibold transition-colors border-2 border-indigo-600 shadow-md disabled:opacity-50"
                    >
                      {saving ? (
                        <>
                          <RefreshCw className="w-4 h-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Zap className="w-4 h-4" />
                          Create {Math.max(0, bulkFormData.endNumber - bulkFormData.startNumber + 1)} Rooms
                        </>
                      )}
                    </button>
                    
                    <button
                      type="button"
                      onClick={() => {
                        resetForm();
                        setShowForm(false);
                      }}
                      className="px-6 py-2 border-2 border-slate-300 hover:bg-slate-100 dark:hover:bg-gray-100 rounded-lg font-semibold transition-colors"
                    >
                      Cancel
                    </button>
                  </div>
                </form>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Success Message */}
        <AnimatePresence>
          {success && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="p-4 bg-emerald-50 border-2 border-emerald-300 rounded-lg text-emerald-700 flex items-center gap-2"
            >
              <CheckCircle2 className="w-5 h-5" />
              {success}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Loading State */}
        {loading && (
          <div className="flex flex-col items-center justify-center py-16 bg-white rounded-xl border-2 border-slate-200">
            <RefreshCw className="w-8 h-8 animate-spin text-indigo-600 mb-4" />
            <p className="text-gray-500 dark:text-gray-500">Loading rooms...</p>
          </div>
        )}

        {/* Rooms Display - Grouped by Building and Floor */}
        {!loading && (
          <div className="space-y-6">
            {Object.entries(groupedRooms).map(([buildingCode, { buildingName, floors }]) => (
              <motion.div
                key={buildingCode}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-white rounded-xl border-2 border-indigo-300 shadow-lg overflow-hidden"
              >
                {/* Building Header - Click to expand/collapse */}
                <div 
                  className="bg-gradient-to-r from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 p-4 border-b-2 border-indigo-200 dark:border-indigo-800 cursor-pointer hover:bg-indigo-100/50 dark:hover:bg-indigo-800/50 transition-colors"
                  onClick={() => toggleBuilding(buildingCode)}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-indigo-100 dark:bg-indigo-800 rounded-lg border-2 border-indigo-300 dark:border-indigo-600">
                        <Building2 className="w-5 h-5 text-indigo-600 dark:text-indigo-700" />
                      </div>
                      <div>
                        <h2 className="text-xl font-bold text-indigo-800 dark:text-indigo-700">
                          {buildingName} <span className="text-sm font-normal text-indigo-600 dark:text-indigo-600 ml-2">({buildingCode})</span>
                        </h2>
                        <p className="text-sm text-gray-500 dark:text-gray-500">
                          {Object.keys(floors).length} floor{Object.keys(floors).length !== 1 ? 's' : ''} • {Object.values(floors).flat().length} room{Object.values(floors).flat().length !== 1 ? 's' : ''}
                        </p>
                      </div>
                    </div>
                    <motion.div
                      animate={{ rotate: expandedBuildings.has(buildingCode) ? 180 : 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <ChevronDown className="w-5 h-5 text-indigo-600 dark:text-indigo-600" />
                    </motion.div>
                  </div>
                </div>

                {/* Floors - Collapsible */}
                <AnimatePresence>
                  {expandedBuildings.has(buildingCode) && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: "auto" }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.3 }}
                      className="p-4 space-y-6"
                    >
                      {Object.entries(floors).map(([floor, rooms]) => (
                        <div key={floor} className="space-y-3">
                          {/* Floor Header */}
                          <div className="flex items-center gap-2 bg-indigo-50/50 dark:bg-indigo-900/20 p-3 rounded-lg border-2 border-indigo-200 dark:border-indigo-800">
                            <Layers className="w-4 h-4 text-indigo-600 dark:text-indigo-600" />
                            <h3 className="font-semibold text-slate-800 dark:text-gray-800">
                              {FLOOR_LABELS[Number(floor)] || `Floor ${floor}`}
                            </h3>
                            <span className="text-sm text-gray-400 dark:text-gray-500 ml-auto">
                              {rooms.length} room{rooms.length !== 1 ? 's' : ''}
                            </span>
                          </div>

                          {/* Rooms Grid - With Time Display */}
                          <div className="grid grid-cols-2 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                            {rooms.map((room) => (
                              <div
                                key={room.id}
                                className={`bg-white border-2 rounded-lg p-3 hover:shadow-md transition-all ${
                                  room.status === "reserved" 
                                    ? "border-amber-300 dark:border-amber-700 hover:border-amber-500" 
                                    : room.status === "occupied"
                                    ? "border-rose-300 dark:border-rose-700 hover:border-rose-500"
                                    : room.status === "free"
                                    ? "border-emerald-300 dark:border-emerald-700 hover:border-emerald-500"
                                    : "border-slate-300"
                                }`}
                              >
                                {/* Room Header */}
                                <div className="flex items-start justify-between mb-2">
                                  <div>
                                    <span className="font-mono font-bold text-indigo-600 dark:text-indigo-600">
                                      {room.roomCode}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-4">
                                    <button
                                      onClick={() => handleEditRoom(room)}
                                      className="p-1.5 hover:bg-slate-100 dark:hover:bg-gray-50 rounded transition-colors"
                                      title="Edit room"
                                    >
                                      <Edit className="w-4 h-4 text-gray-500 dark:text-gray-500" />
                                    </button>
                                    <button
                                      onClick={() => setDeleteConfirm(room)}
                                      className="p-1.5 hover:bg-rose-100 dark:hover:bg-rose-900/30 rounded transition-colors"
                                      title="Delete room"
                                    >
                                      <Trash2 className="w-4 h-4 text-rose-600" />
                                    </button>
                                  </div>
                                </div>

                                {/* Status Badge */}
                                <div className="mb-2">
                                  <StatusBadge status={room.status} />
                                </div>

                                {/* Room Details */}
                                <div className="space-y-1 text-xs text-gray-500 dark:text-gray-500">
                                  <div className="flex items-center gap-2">
                                    <Users className="w-3 h-3" />
                                    <span>Capacity: {room.capacity}</span>
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <span className="text-base">{ROOM_TYPES.find(t => t.value === room.type)?.icon}</span>
                                    <span className="capitalize">{room.type}</span>
                                  </div>
                                </div>

                                {/* Time Display for Reserved/Occupied Rooms */}
                                <TimeDisplay room={room} />
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            ))}

            {Object.keys(groupedRooms).length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center py-16 bg-white rounded-xl border-2 border-slate-200">
                <Building2 className="w-12 h-12 text-gray-500 mb-4" />
                <p className="text-gray-500 dark:text-gray-500 mb-2">No rooms found</p>
                <button
                  onClick={() => {
                    resetForm();
                    setShowForm(true);
                    setActiveTab("single");
                  }}
                  className="text-indigo-600 hover:text-indigo-700 font-semibold"
                >
                  Add your first room
                </button>
              </div>
            )}
          </div>
        )}

        {/* Delete Confirmation Modal */}
        <AnimatePresence>
          {deleteConfirm && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50"
              onClick={() => setDeleteConfirm(null)}
            >
              <motion.div
                initial={{ scale: 0.9 }}
                animate={{ scale: 1 }}
                exit={{ scale: 0.9 }}
                className="bg-white rounded-xl p-6 max-w-md w-full border-2 border-rose-300 dark:border-rose-700 shadow-xl"
                onClick={(e) => e.stopPropagation()}
              >
                <h3 className="text-xl font-bold mb-2">Confirm Delete</h3>
                <p className="text-gray-500 dark:text-gray-500 mb-6">
                  Are you sure you want to delete {deleteConfirm.roomCode}? This action cannot be undone.
                </p>
                <div className="flex gap-3">
                  <button
                    onClick={() => setDeleteConfirm(null)}
                    className="flex-1 px-4 py-2 border-2 border-slate-300 hover:bg-slate-100 dark:hover:bg-gray-100 rounded-lg font-semibold transition-colors"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={() => handleDeleteRoom(deleteConfirm)}
                    disabled={saving}
                    className="flex-1 px-4 py-2 bg-rose-600 hover:bg-rose-700 text-gray-900 rounded-lg font-semibold transition-colors border-2 border-rose-400 disabled:opacity-50"
                  >
                    {saving ? "Deleting..." : "Delete"}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Building Name Editor Modal */}
        <BuildingNameEditor
          isOpen={showBuildingEditor}
          onClose={() => setShowBuildingEditor(false)}
          buildingNames={buildingNames}
          onSave={setBuildingNames}
        />
      </div>
    </div>
  );
}