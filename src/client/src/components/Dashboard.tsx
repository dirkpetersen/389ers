import { useState, useEffect } from 'react';
import MemberList from './MemberList';
import UserSearch from './UserSearch';
import BulkAddModal from './BulkAddModal';
import GroupForm from './GroupForm';

interface User {
  username: string;
  isAdmin: boolean;
}

interface GroupSummary {
  cn: string;
  description: string;
  gidNumber: number;
  memberCount: number;
  canManage: boolean;
}

interface GroupDetail {
  dn: string;
  cn: string;
  gidNumber: number;
  description: string;
  memberCount: number;
  members: Member[];
  managedBy: string[];
  canManage: boolean;
}

interface Member {
  uid: string;
  cn: string;
  mail?: string;
}

interface DashboardProps {
  user: User;
  onLogout: () => void;
}

export default function Dashboard({ user, onLogout }: DashboardProps) {
  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [selectedGroupCn, setSelectedGroupCn] = useState<string | null>(null);
  const [groupDetail, setGroupDetail] = useState<GroupDetail | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);

  // Modal states
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [showBulkAdd, setShowBulkAdd] = useState(false);
  const [showCreateGroup, setShowCreateGroup] = useState(false);
  const [showEditGroup, setShowEditGroup] = useState(false);

  // Selected users for add members modal
  const [selectedUsers, setSelectedUsers] = useState<Member[]>([]);

  useEffect(() => {
    loadGroups();
  }, []);

  useEffect(() => {
    if (selectedGroupCn) {
      loadGroupDetail(selectedGroupCn);
    } else {
      setGroupDetail(null);
    }
  }, [selectedGroupCn]);

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

  const loadGroupDetail = async (cn: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(cn)}`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setGroupDetail(data);
      }
    } catch (err) {
      console.error('Failed to load group detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRemoveMember = async (uid: string) => {
    if (!groupDetail || !confirm(`Remove ${uid} from ${groupDetail.cn}?`)) return;

    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(groupDetail.cn)}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members: [uid] }),
        credentials: 'include',
      });

      if (res.ok) {
        await loadGroupDetail(groupDetail.cn);
        await loadGroups();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to remove member');
      }
    } catch (err) {
      console.error('Remove member error:', err);
      alert('Failed to remove member');
    }
  };

  const handleAddMembers = async () => {
    if (!groupDetail || selectedUsers.length === 0) return;

    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(groupDetail.cn)}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ members: selectedUsers.map(u => u.uid) }),
        credentials: 'include',
      });

      if (res.ok) {
        setSelectedUsers([]);
        setShowAddMembers(false);
        await loadGroupDetail(groupDetail.cn);
        await loadGroups();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to add members');
      }
    } catch (err) {
      console.error('Add members error:', err);
      alert('Failed to add members');
    }
  };

  const handleBulkAdd = async (uids: string[]) => {
    if (!groupDetail) return;

    const res = await fetch(`/api/groups/${encodeURIComponent(groupDetail.cn)}/members`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ members: uids }),
      credentials: 'include',
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Failed to add members');
    }

    const result = await res.json();
    await loadGroupDetail(groupDetail.cn);
    await loadGroups();

    if (result.notFound?.length > 0) {
      alert(`Added ${result.added.length} members. ${result.notFound.length} users not found: ${result.notFound.join(', ')}`);
    }
  };

  const handleCreateGroup = async (data: { cn: string; description: string; members: string[] }) => {
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'include',
    });

    if (!res.ok) {
      const result = await res.json();
      throw new Error(result.error || 'Failed to create group');
    }

    await loadGroups();
    const result = await res.json();
    setSelectedGroupCn(result.cn);
  };

  const handleEditGroup = async (data: { cn: string; description: string }) => {
    if (!groupDetail) return;

    const res = await fetch(`/api/groups/${encodeURIComponent(groupDetail.cn)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: data.description }),
      credentials: 'include',
    });

    if (!res.ok) {
      const result = await res.json();
      throw new Error(result.error || 'Failed to update group');
    }

    await loadGroupDetail(groupDetail.cn);
    await loadGroups();
  };

  const handleDeleteGroup = async () => {
    if (!groupDetail || !confirm(`Delete group "${groupDetail.cn}"? This cannot be undone.`)) return;

    try {
      const res = await fetch(`/api/groups/${encodeURIComponent(groupDetail.cn)}`, {
        method: 'DELETE',
        credentials: 'include',
      });

      if (res.ok) {
        setSelectedGroupCn(null);
        await loadGroups();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to delete group');
      }
    } catch (err) {
      console.error('Delete group error:', err);
      alert('Failed to delete group');
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
              {user.isAdmin && (
                <button
                  onClick={() => setShowCreateGroup(true)}
                  className="px-4 py-2 text-sm bg-green-600 hover:bg-green-700 rounded transition-colors"
                >
                  + New Group
                </button>
              )}
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
                    onClick={() => setSelectedGroupCn(group.cn)}
                    className={`p-4 cursor-pointer hover:bg-gray-50 transition-colors ${
                      selectedGroupCn === group.cn ? 'bg-osu-orange bg-opacity-10 border-l-4 border-osu-orange' : ''
                    }`}
                  >
                    <div className="flex justify-between items-start">
                      <div className="font-medium text-gray-900">{group.cn}</div>
                      {group.canManage && (
                        <span className="text-xs bg-green-100 text-green-800 px-2 py-0.5 rounded">
                          Can Manage
                        </span>
                      )}
                    </div>
                    <div className="text-sm text-gray-600 truncate">{group.description}</div>
                    <div className="text-xs text-gray-500 mt-1">
                      GID: {group.gidNumber} | {group.memberCount} members
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
              {detailLoading ? (
                <div className="text-center text-gray-500 py-12">Loading group details...</div>
              ) : groupDetail ? (
                <div className="space-y-6">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Group Name
                      </label>
                      <div className="text-lg font-semibold text-gray-900">{groupDetail.cn}</div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        GID Number
                      </label>
                      <div className="text-gray-900 font-mono">{groupDetail.gidNumber}</div>
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Description
                    </label>
                    <div className="text-gray-900">{groupDetail.description}</div>
                  </div>

                  <div>
                    <div className="flex justify-between items-center mb-2">
                      <label className="block text-sm font-medium text-gray-700">
                        Members ({groupDetail.members.length})
                      </label>
                      {groupDetail.canManage && (
                        <div className="space-x-2">
                          <button
                            onClick={() => setShowAddMembers(true)}
                            className="px-3 py-1 text-sm bg-osu-orange text-white rounded hover:bg-osu-orange-dark transition-colors"
                          >
                            + Add
                          </button>
                          <button
                            onClick={() => setShowBulkAdd(true)}
                            className="px-3 py-1 text-sm bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
                          >
                            Bulk Add
                          </button>
                        </div>
                      )}
                    </div>
                    <MemberList
                      members={groupDetail.members}
                      canManage={groupDetail.canManage}
                      onRemove={handleRemoveMember}
                    />
                  </div>

                  {groupDetail.canManage && (
                    <div className="pt-4 border-t border-gray-200 flex justify-between">
                      <button
                        onClick={() => setShowEditGroup(true)}
                        className="px-4 py-2 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 transition-colors"
                      >
                        Edit Group
                      </button>
                      {user.isAdmin && (
                        <button
                          onClick={handleDeleteGroup}
                          className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                        >
                          Delete Group
                        </button>
                      )}
                    </div>
                  )}
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

      {/* Add Members Modal */}
      {showAddMembers && groupDetail && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="fixed inset-0 bg-black bg-opacity-50" onClick={() => {
            setShowAddMembers(false);
            setSelectedUsers([]);
          }} />
          <div className="flex min-h-full items-center justify-center p-4">
            <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">
                Add Members to {groupDetail.cn}
              </h3>
              <UserSearch
                selectedUsers={selectedUsers}
                onSelect={setSelectedUsers}
                placeholder="Search users to add..."
              />
              <div className="mt-6 flex justify-end space-x-3">
                <button
                  onClick={() => {
                    setShowAddMembers(false);
                    setSelectedUsers([]);
                  }}
                  className="px-4 py-2 text-gray-700 bg-gray-200 rounded hover:bg-gray-300 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleAddMembers}
                  disabled={selectedUsers.length === 0}
                  className="px-4 py-2 text-white bg-osu-orange rounded hover:bg-osu-orange-dark transition-colors disabled:opacity-50"
                >
                  Add {selectedUsers.length} Member{selectedUsers.length !== 1 ? 's' : ''}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Add Modal */}
      <BulkAddModal
        isOpen={showBulkAdd}
        onClose={() => setShowBulkAdd(false)}
        onSubmit={handleBulkAdd}
        groupName={groupDetail?.cn || ''}
      />

      {/* Create Group Modal */}
      <GroupForm
        isOpen={showCreateGroup}
        onClose={() => setShowCreateGroup(false)}
        onSubmit={handleCreateGroup}
        mode="create"
      />

      {/* Edit Group Modal */}
      <GroupForm
        isOpen={showEditGroup}
        onClose={() => setShowEditGroup(false)}
        onSubmit={handleEditGroup}
        mode="edit"
        initialData={groupDetail ? { cn: groupDetail.cn, description: groupDetail.description } : undefined}
      />
    </div>
  );
}
