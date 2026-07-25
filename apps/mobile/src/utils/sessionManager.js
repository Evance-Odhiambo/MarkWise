let _sessionEndTime = null;
let _timeoutId = null;
const _listeners = new Set();

const startSession = (durationMs) => {
  stopSession();
  _sessionEndTime = Date.now() + durationMs;
  _timeoutId = setTimeout(() => {
    _sessionEndTime = null;
    _timeoutId = null;
    _notifyListeners();
  }, durationMs);
};

const startSessionAt = (startTimestamp, durationMs) => {
  stopSession();
  const end = startTimestamp + durationMs;
  if (end <= Date.now()) {
    // session already expired
    _sessionEndTime = null;
    _notifyListeners();
    return;
  }
  _sessionEndTime = end;
  const msUntilEnd = end - Date.now();
  _timeoutId = setTimeout(() => {
    _sessionEndTime = null;
    _timeoutId = null;
    _notifyListeners();
  }, msUntilEnd);
  _notifyListeners();
};

const stopSession = () => {
  if (_timeoutId) {
    clearTimeout(_timeoutId);
    _timeoutId = null;
  }
  _sessionEndTime = null;
  _notifyListeners();
};

const isSessionActive = () => {
  return !!_sessionEndTime && Date.now() < _sessionEndTime;
};

const getSessionEnd = () => _sessionEndTime;

const onSessionEnd = (cb) => {
  _listeners.add(cb);
  return cb;
};

const removeListener = (cb) => {
  _listeners.delete(cb);
};

const _notifyListeners = () => {
  for (const cb of Array.from(_listeners)) {
    try {
      cb();
    } catch (e) {
      console.error('sessionManager listener error', e);
    }
  }
};

export default {
  startSession,
  startSessionAt,
  stopSession,
  isSessionActive,
  getSessionEnd,
  onSessionEnd,
  removeListener,
};
