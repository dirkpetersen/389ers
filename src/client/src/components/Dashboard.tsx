import { useState, useEffect } from 'react'

interface User {
  username: string;
  isAdmin: boolean;
}

interface Group {
  cn: string;
  description: string;
  gidNumber: number;
  memberCount: number;
}

interface DashboardProps {
  user: User;
  onLogout: () => void;
}

export default function Dashboard({ user, onLogout }: DashboardProps) {
  const [groups, setGroups] = useState<Group[]>([]);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = async () => {
    try {
      const res = await fetch('/api/groups', { credentials: 'include' });
      const data = await res.json();
      setGroups(data.groups);
    } catch (err) {
      console.error('Failed to load groups:', err);
    } finally {
      setLoading(false);
    }
  };

  const filteredGroups = groups.filter(g =>
    g.cn.toLowerCase().includes(searchTerm.toLowerCase()) ||
    g.description.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <div className="bg-osu-black text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16">
            <div>
              <h1 className="text-xl font-bold">RCO Group Manager</h1>
              <p className="text-xs text-gray-300">My lovely University</p>
            </div>
            <div className="flex items-center space-x-4">
              <div className="text-right">
                <div className="text-sm font-medium">{user.username}</div>
                {user.isAdmin && (
                  <div className="text-xs text-osu-orange">Administrator</div>
                )}
              </div>
              <button
                onClick={onLogout}
                className="px-4 py-2 text-sm bg-osu-orange hover:bg-osu-orange-dark rounded transition-colors"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Search Bar */}
        <div className="mb-6">
          <input
            type="text"
            placeholder="Search groups by name or description..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-osu-orange focus:border-transparent text-lg"
          />
        </div>

        {/* Split Panel Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Groups List */}
          <div className="lg:col-span-1 bg-white rounded-lg shadow-md overflow-hidden">
            <div className="bg-osu-orange text-white px-4 py-3 font-semibold">
              Groups ({filteredGroups.length})
            </div>
            <div className="divide-y divide-gray-200 max-h-[calc(100vh-300px)] overflow-y-auto">
              {loading ? (
                <div className="p-4 text-center text-gray-500">Loading...</div>
              ) : filteredGroups.length === 0 ? (
                <div className="p-4 text-center text-gray-500">No groups found</div>
              ) : (
                filteredGroups.map((group) => (
                  <div
                    key={group.cn}
                    onClick={() => setSelectedGroup(group)}
                    className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedGroup?.cn === group.cn ? 'bg-osu-orange bg-opacity-10 border-l-4 border-osu-orange' : ''
                    }`}
                  >
                    <div className="font-medium text-gray-900">{group.cn}</div>
                    <div className="text-sm text-gray-600 truncate">{group.description}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      GID: {group.gidNumber} • {group.memberCount} members
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Group Details */}
          <div className="lg:col-span-2 bg-white rounded-lg shadow-md overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <h3 className="text-lg font-semibold text-gray-900">Group Details</h3>
            </div>
            <div className="p-6">
              {selectedGroup ? (
                <div className="space-y-6">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Group Name
                    </label>
                    <div className="text-lg font-semibold text-gray-900">{selectedGroup.cn}</div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <div className="text-gray-900">{selectedGroup.description}</div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      GID Number
                    </label>
                    <div className="text-gray-900 font-mono">{selectedGroup.gidNumber}</div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Members ({selectedGroup.memberCount})
                    </label>
                    <div className="bg-gray-50 rounded p-4 text-gray-600 text-sm">
                      Member management coming soon...
                    </div>
                  </div>
                  <div className="pt-4 border-t border-gray-200">
                    <button className="px-4 py-2 bg-osu-orange text-white rounded hover:bg-osu-orange-dark transition-colors mr-2">
                      Add Members
                    </button>
                    <button className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors">
                      Edit Group
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-center text-gray-500 py-12">
                  Select a group to view details
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
