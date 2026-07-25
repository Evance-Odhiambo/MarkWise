import { resolveApiBaseUrl } from './unitsApi';
import { getLecturerSession, clearLecturerSession } from './authSession';

export const deleteLecturerAccount = async () => {
  const baseUrl = resolveApiBaseUrl();
  const session = await getLecturerSession();
  if (!session?.token) throw new Error('No lecturer session or token found');

  const response = await fetch(`${baseUrl}/api/auth/lecturer/account`, {
    method: 'DELETE',
    headers: {
      'Authorization': `Bearer ${session.token}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(error || 'Failed to delete account');
  }

  await clearLecturerSession();
  return true;
};
