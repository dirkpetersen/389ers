import { useState } from 'react';
import UserSearch from './UserSearch';

interface User {
  uid: string;
  cn: string;
  mail?: string;
}

interface GroupFormProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (data: { cn: string; description: string; members: string[] }) => Promise<void>;
  mode: 'create' | 'edit';
  initialData?: {
    cn: string;
    description: string;
  };
}

export default function GroupForm({ isOpen, onClose, onSubmit, mode, initialData }: GroupFormProps) {
  const [cn, setCn] = useState(initialData?.cn || '');
  const [description, setDescription] = useState(initialData?.description || '');
  const [selectedUsers, setSelectedUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!cn.trim()) {
      setError('Group name is required');
      return;
    }

    if (!description.trim()) {
      setError('Description is required');
      return;
    }

    // Validate cn format
    if (!/^[a-zA-Z0-9_-]+$/.test(cn)) {
      setError('Group name must be alphanumeric with hyphens/underscores only');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onSubmit({
        cn: cn.trim(),
        description: description.trim(),
        members: selectedUsers.map(u => u.uid),
      });
      handleClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save group');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setCn(initialData?.cn || '');
    setDescription(initialData?.description || '');
    setSelectedUsers([]);
    setError('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={handleClose} />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-6">
            {mode === 'create' ? 'Create New Group' : 'Edit Group'}
          </h3>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="cn" className="block text-sm font-medium text-gray-700 mb-1">
                Group Name *
              </label>
              <input
                id="cn"
                type="text"
                value={cn}
                onChange={(e) => setCn(e.target.value)}
                disabled={mode === 'edit'}
                placeholder="my-research-group"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-osu-orange focus:border-transparent disabled:bg-gray-100 disabled:text-gray-500"
              />
              {mode === 'create' && (
                <p className="mt-1 text-xs text-gray-500">
                  Alphanumeric characters, hyphens, and underscores only
                </p>
              )}
            </div>

            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-1">
                Description *
              </label>
              <input
                id="description"
                type="text"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Research group for HPC cluster access"
                className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-osu-orange focus:border-transparent"
              />
            </div>

            {mode === 'create' && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Initial Members (optional)
                </label>
                <UserSearch
                  selectedUsers={selectedUsers}
                  onSelect={setSelectedUsers}
                  placeholder="Search users to add..."
                />
              </div>
            )}

            {error && (
              <div className="p-3 bg-red-50 rounded text-red-700 text-sm">
                {error}
              </div>
            )}

            <div className="flex justify-end space-x-3 pt-4">
              <button
                type="button"
                onClick={handleClose}
                disabled={loading}
                className="px-4 py-2 text-gray-700 bg-gray-200 rounded hover:bg-gray-300 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading}
                className="px-4 py-2 text-white bg-osu-orange rounded hover:bg-osu-orange-dark transition-colors disabled:opacity-50"
              >
                {loading ? 'Saving...' : mode === 'create' ? 'Create Group' : 'Save Changes'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
