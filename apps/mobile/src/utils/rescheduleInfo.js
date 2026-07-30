export const parseRescheduledInfo = (rescheduledTo, rescheduledVenue) => {
  const combined = String(rescheduledTo || '').trim();
  const venue = String(rescheduledVenue || '').trim();

  if (!combined) {
    return { time: null, roomCode: venue || null };
  }

  const separators = ['·', '|'];
  let parsedTime = combined;
  let parsedRoom = '';

  for (const separator of separators) {
    const idx = combined.indexOf(separator);
    if (idx !== -1) {
      parsedTime = combined.slice(0, idx).trim() || null;
      parsedRoom = combined.slice(idx + separator.length).trim() || '';
      break;
    }
  }

  if (!parsedRoom && venue) {
    parsedRoom = venue;
  }

  return {
    time: parsedTime || null,
    roomCode: parsedRoom || null,
  };
};
