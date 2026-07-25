import { resolveApiBaseUrl } from './unitsApi';
import { getStudentSession, clearStudentSession } from './authSession';

export const deleteStudentAccount = async () => {
  const baseUrl = resolveApiBaseUrl();
  const session = await getStudentSession();
  if (!session?.token) throw new Error('No student session or token found');

  const response = await fetch(`${baseUrl}/api/auth/student/account`, {
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

  await clearStudentSession();
  return true;
};
