import { API_BASE_URL } from './constants';
import { getStudentSession } from './authSession';

// Fetch a student's own submission for a given assignment
export async function fetchStudentSubmission(assignmentId) {
  const session = await getStudentSession();
  const headers = { Authorization: `Bearer ${session?.token}` };
  const res = await fetch(`${API_BASE_URL}/assignments/${assignmentId}/submission`, { headers });
  if (!res.ok) throw new Error('Failed to fetch your submission');
  return res.json();
}
