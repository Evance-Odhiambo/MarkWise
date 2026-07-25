// Room listing API — used by AssignedTimetableScreen for conflict detection.
import { API_BASE_URL } from './constants';
const API_PREFIX = API_BASE_URL + '/api';

// Fetch a list of rooms and their statuses for an institution.
export async function fetchRooms({ institutionId, token }) {
  try {
    const res = await fetch(`${API_PREFIX}/rooms?institutionId=${institutionId}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) throw new Error(await res.text());
    return await res.json();
  } catch (error) {
    throw new Error('Failed to fetch rooms: ' + error.message);
  }
}
