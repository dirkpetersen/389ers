import { useState } from 'react';

interface BulkAddModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (uids: string[]) => Promise<void>;
  groupName: string;
}

export default function BulkAddModal({ isOpen, onClose, onSubmit, groupName }: BulkAddModalProps) {
  const [text, setText] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const parseUserIds = (input: string): string[] => {
    // Split by whitespace, commas, or newlines and filter empty strings
    return input
      .split(/[\s,\n]+/)
      .map(s => s.trim())
      .filter(s => s.length > 0);
  };

  const handleSubmit = async () => {
    const uids = parseUserIds(text);
    if (uids.length === 0) {
      setError('Please enter at least one user ID');
      return;
    }

    setLoading(true);
    setError('');

    try {
      await onSubmit(uids);
      setText('');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add members');
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setText('');
    setError('');
    onClose();
  };

  const previewUids = parseUserIds(text);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black bg-opacity-50" onClick={handleClose} />

      {/* Modal */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            Bulk Add Members to {groupName}
          </h3>

          <p className="text-sm text-gray-600 mb-4">
            Enter user IDs separated by spaces, commas, or newlines.
          </p>

          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="user1 user2 user3&#10;user4, user5&#10;user6"
            rows={6}
            className="w-full px-3 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-osu-orange focus:border-transparent font-mono text-sm"
          />

          {previewUids.length > 0 && (
            <div className="mt-3 p-3 bg-gray-50 rounded">
              <div className="text-sm font-medium text-gray-700 mb-2">
                Preview ({previewUids.length} users):
              </div>
              <div className="flex flex-wrap gap-1">
                {previewUids.slice(0, 20).map((uid, i) => (
                  <span
                    key={i}
                    className="px-2 py-1 bg-white border border-gray-200 rounded text-xs font-mono"
                  >
                    {uid}
                  </span>
                ))}
                {previewUids.length > 20 && (
                  <span className="px-2 py-1 text-xs text-gray-500">
                    +{previewUids.length - 20} more
                  </span>
                )}
              </div>
            </div>
          )}

          {error && (
            <div className="mt-3 p-3 bg-red-50 rounded text-red-700 text-sm">
              {error}
            </div>
          )}

          <div className="mt-6 flex justify-end space-x-3">
            <button
              onClick={handleClose}
              disabled={loading}
              className="px-4 py-2 text-gray-700 bg-gray-200 rounded hover:bg-gray-300 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={loading || previewUids.length === 0}
              className="px-4 py-2 text-white bg-osu-orange rounded hover:bg-osu-orange-dark transition-colors disabled:opacity-50"
            >
              {loading ? 'Adding...' : `Add ${previewUids.length} Member${previewUids.length !== 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
