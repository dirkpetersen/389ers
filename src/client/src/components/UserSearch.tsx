import { useState, useEffect, useRef } from 'react';
import { useDebounce } from '../hooks/useDebounce';

interface User {
  uid: string;
  cn: string;
  mail?: string;
}

interface UserSearchProps {
  onSelect: (users: User[]) => void;
  selectedUsers: User[];
  placeholder?: string;
}

export default function UserSearch({ onSelect, selectedUsers, placeholder = "Search users..." }: UserSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<User[]>([]);
  const [loading, setLoading] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const debouncedQuery = useDebounce(query, 300);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (debouncedQuery.length < 2) {
      setResults([]);
      return;
    }

    const searchUsers = async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/users?q=${encodeURIComponent(debouncedQuery)}`, {
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          // Filter out already selected users
          const selectedUids = new Set(selectedUsers.map(u => u.uid));
          const filtered = data.entries.filter((u: User) => !selectedUids.has(u.uid));
          setResults(filtered);
        }
      } catch (err) {
        console.error('User search error:', err);
      } finally {
        setLoading(false);
      }
    };

    searchUsers();
  }, [debouncedQuery, selectedUsers]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setShowDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelect = (user: User) => {
    onSelect([...selectedUsers, user]);
    setQuery('');
    setResults([]);
  };

  const handleRemove = (uid: string) => {
    onSelect(selectedUsers.filter(u => u.uid !== uid));
  };

  return (
    <div ref={containerRef} className="relative">
      {/* Selected users chips */}
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {selectedUsers.map((user) => (
            <span
              key={user.uid}
              className="inline-flex items-center px-3 py-1 rounded-full text-sm bg-osu-orange bg-opacity-10 text-osu-orange"
            >
              {user.cn} ({user.uid})
              <button
                onClick={() => handleRemove(user.uid)}
                className="ml-2 hover:text-osu-orange-dark"
              >
                &times;
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Search input */}
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onFocus={() => setShowDropdown(true)}
        placeholder={placeholder}
        className="w-full px-4 py-2 border border-gray-300 rounded focus:outline-none focus:ring-2 focus:ring-osu-orange focus:border-transparent"
      />

      {/* Dropdown results */}
      {showDropdown && (query.length >= 2 || results.length > 0) && (
        <div className="absolute z-10 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg max-h-60 overflow-auto">
          {loading ? (
            <div className="px-4 py-3 text-gray-500 text-center">Searching...</div>
          ) : results.length === 0 ? (
            <div className="px-4 py-3 text-gray-500 text-center">
              {query.length < 2 ? 'Type at least 2 characters' : 'No users found'}
            </div>
          ) : (
            results.map((user) => (
              <button
                key={user.uid}
                onClick={() => handleSelect(user)}
                className="w-full px-4 py-3 text-left hover:bg-gray-100 border-b border-gray-100 last:border-b-0"
              >
                <div className="font-medium text-gray-900">{user.cn}</div>
                <div className="text-sm text-gray-600">
                  {user.uid} {user.mail && `- ${user.mail}`}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
