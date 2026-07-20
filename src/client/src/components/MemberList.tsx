interface Member {
  uid: string;
  cn: string;
  mail?: string;
}

interface MemberListProps {
  members: Member[];
  canManage: boolean;
  onRemove: (uid: string) => void;
  loading?: boolean;
}

export default function MemberList({ members, canManage, onRemove, loading }: MemberListProps) {
  if (loading) {
    return (
      <div className="bg-gray-50 rounded p-4 text-center text-gray-500">
        Loading members...
      </div>
    );
  }

  if (members.length === 0) {
    return (
      <div className="bg-gray-50 rounded p-4 text-center text-gray-500">
        No members in this group
      </div>
    );
  }

  return (
    <div className="bg-gray-50 rounded overflow-hidden">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-100">
          <tr>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Name
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              UID
            </th>
            <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
              Email
            </th>
            {canManage && (
              <th className="px-4 py-2 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Action
              </th>
            )}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {members.map((member) => (
            <tr key={member.uid} className="hover:bg-gray-50">
              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900">
                {member.cn}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600 font-mono">
                {member.uid}
              </td>
              <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                {member.mail || '-'}
              </td>
              {canManage && (
                <td className="px-4 py-3 whitespace-nowrap text-right text-sm">
                  <button
                    onClick={() => onRemove(member.uid)}
                    className="text-red-600 hover:text-red-800 font-medium"
                  >
                    Remove
                  </button>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
