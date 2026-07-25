import React, { useEffect } from 'react';
import { Alert } from 'react-native';
import { pick, types, isCancel } from '@react-native-documents/picker';

const getMimeType = (filename) => {
  const ext = (filename.split('.').pop() || '').toLowerCase();
  const map = {
    pdf: 'application/pdf',
    doc: 'application/msword',
    docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    xls: 'application/vnd.ms-excel',
    xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ppt: 'application/vnd.ms-powerpoint',
    pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    txt: 'text/plain',
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    gif: 'image/gif',
    webp: 'image/webp',
    svg: 'image/svg+xml',
    csv: 'text/csv',
    json: 'application/json',
    mp4: 'video/mp4',
    mp3: 'audio/mpeg',
    zip: 'application/zip',
    rar: 'application/x-rar-compressed',
  };
  return map[ext] || 'application/octet-stream';
};

const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100 MB

/**
 * FilePicker — wraps @react-native-documents/picker (SAF / iCloud Drive picker).
 *
 * Uses the platform document-picker intent. No storage permissions are required
 * on any Android or iOS version. Launches the OS picker as soon as `visible`
 * flips to true, then calls `onClose` once the user confirms or cancels.
 *
 * Interface identical to the previous custom file-browser version:
 *   visible   {boolean}
 *   onClose   {() => void}
 *   onSelect  {(files: Array<{uri, name, type, size}>) => void}
 *   multiple  {boolean}  default false
 */
export default function FilePicker({ visible, onClose, onSelect, multiple = false }) {
  useEffect(() => {
    if (!visible) return;

    let active = true;

    const launch = async () => {
      try {
        const results = await pick({
          type: [types.allFiles],
          allowMultiSelection: multiple,
        });

        if (!active) return;

        // File size guard (50 MB)
        const oversized = results.filter(r => (r.size || 0) > MAX_FILE_SIZE);
        if (oversized.length > 0) {
          Alert.alert(
            'File Too Large',
            `"${oversized[0].name}" exceeds the 100 MB size limit. Please choose a smaller file.`,
          );
          onClose();
          return;
        }

        const files = results.map(r => ({
          uri:  r.uri,
          name: r.name || r.uri.split('/').pop() || 'file',
          type: r.type || getMimeType(r.name || ''),
          size: r.size || 0,
        }));

        onSelect(files);
      } catch (e) {
        if (!active) return;
        if (!isCancel(e)) {
          Alert.alert('File Error', 'Could not open the selected file. Please try again.');
        }
      } finally {
        if (active) onClose();
      }
    };

    launch();
    return () => { active = false; };
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // No UI — the OS handles the picker sheet.
  return null;
}


