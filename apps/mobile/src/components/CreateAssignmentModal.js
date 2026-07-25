import React, { useState } from 'react';
import { Modal, View, Text, TextInput, Button, StyleSheet, TouchableOpacity, Platform } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
const CreateAssignmentModal = ({ visible, onClose, onCreate }) => {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueDate, setDueDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [allowedTypes, setAllowedTypes] = useState({ file: true, link: true, text: true });
  const [isGroup, setIsGroup] = useState(false);
  const [blockLate, setBlockLate] = useState(false);
  const [allowResub, setAllowResub] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleCreate = async () => {
    if (!title.trim()) return alert('Title is required');
    setLoading(true);
    await onCreate({
      title,
      description,
      dueDate,
      allowedTypes: Object.keys(allowedTypes).filter(k => allowedTypes[k]),
      isGroup,
      blockLate,
      allowResub,
    });
    setTitle('');
    setDescription('');
    setDueDate(new Date());
    setAllowedTypes({ file: true, link: true, text: true });
    setIsGroup(false);
    setBlockLate(false);
    setAllowResub(true);
    setLoading(false);
  };

  const handleDateChange = (event, selectedDate) => {
    setShowDatePicker(false);
    if (selectedDate) setDueDate(selectedDate);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.overlay}>
        <View style={styles.container}>
          <Text style={styles.header}>Create Assignment</Text>
          <TextInput
            style={styles.input}
            placeholder="Title"
            value={title}
            onChangeText={setTitle}
          />
          <TextInput
            style={[styles.input, { height: 80 }]}
            placeholder="Instructions / Description"
            value={description}
            onChangeText={setDescription}
            multiline
          />
          <TouchableOpacity onPress={() => setShowDatePicker(true)} style={styles.dateButton}>
            <Text style={styles.dateText}>Due: {dueDate.toLocaleString()}</Text>
          </TouchableOpacity>
          {showDatePicker && (
            <DateTimePicker
              value={dueDate}
              mode="datetime"
              display={Platform.OS === 'ios' ? 'inline' : 'default'}
              onChange={handleDateChange}
            />
          )}
          <Text style={{ marginTop: 10, fontWeight: 'bold' }}>Allowed Submission Types:</Text>
          <View style={{ flexDirection: 'row', marginBottom: 10 }}>
            <TouchableOpacity style={[styles.typeButton, allowedTypes.file && styles.typeButtonActive]} onPress={() => setAllowedTypes(t => ({ ...t, file: !t.file }))}>
              <Text>File</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.typeButton, allowedTypes.link && styles.typeButtonActive]} onPress={() => setAllowedTypes(t => ({ ...t, link: !t.link }))}>
              <Text>Link</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.typeButton, allowedTypes.text && styles.typeButtonActive]} onPress={() => setAllowedTypes(t => ({ ...t, text: !t.text }))}>
              <Text>Text</Text>
            </TouchableOpacity>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 10 }}>
            <Text>Group Assignment</Text>
            <TouchableOpacity onPress={() => setIsGroup(v => !v)} style={[styles.switch, isGroup && styles.switchActive]}>
              <View style={[styles.switchKnob, isGroup && styles.switchKnobActive]} />
            </TouchableOpacity>
            <Text style={{ marginLeft: 16 }}>Block Late</Text>
            <TouchableOpacity onPress={() => setBlockLate(v => !v)} style={[styles.switch, blockLate && styles.switchActive]}>
              <View style={[styles.switchKnob, blockLate && styles.switchKnobActive]} />
            </TouchableOpacity>
            <Text style={{ marginLeft: 16 }}>Allow Resub</Text>
            <TouchableOpacity onPress={() => setAllowResub(v => !v)} style={[styles.switch, allowResub && styles.switchActive]}>
              <View style={[styles.switchKnob, allowResub && styles.switchKnobActive]} />
            </TouchableOpacity>
          </View>
          <View style={styles.buttonRow}>
            <Button title="Cancel" onPress={onClose} color="#888" disabled={loading} />
            <Button title={loading ? 'Creating...' : 'Create'} onPress={handleCreate} disabled={loading} />
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '90%',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 20,
    elevation: 5,
  },
  header: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  input: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    padding: 10,
    marginBottom: 10,
  },
  typeButton: {
    borderWidth: 1,
    borderColor: '#ccc',
    borderRadius: 5,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 8,
    backgroundColor: '#f0f0f0',
  },
  typeButtonActive: {
    backgroundColor: '#22C55E',
    borderColor: '#22C55E',
  },
  switch: {
    width: 36,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#ccc',
    marginHorizontal: 6,
    justifyContent: 'center',
  },
  switchActive: {
    backgroundColor: '#22C55E',
  },
  switchKnob: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#fff',
    marginLeft: 2,
    marginRight: 2,
    alignSelf: 'flex-start',
  },
  switchKnobActive: {
    alignSelf: 'flex-end',
  },
  dateButton: {
    padding: 10,
    backgroundColor: '#f0f0f0',
    borderRadius: 5,
    marginBottom: 10,
  },
  dateText: {
    color: '#333',
  },
  buttonRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
  },
});

export default CreateAssignmentModal;
