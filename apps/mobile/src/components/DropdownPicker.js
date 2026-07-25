import React, { useMemo, useState } from 'react';
import {
  View, Text, TouchableOpacity, Modal, StyleSheet, ScrollView,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useColors } from '../theme';

/**
 * A bottom-sheet dropdown that replaces horizontal scrolling chip rows.
 *
 * Props:
 *   value        — currently selected option value
 *   options      — [{ value, label, icon? }]  (icon = MaterialCommunityIcons name)
 *   onChange     — (value) => void
 *   placeholder  — string shown when no match found
 *   accentColor  — highlight color for selected item + border
 *   style        — extra style for the trigger button
 */
export default function DropdownPicker({
  value,
  options = [],
  onChange,
  placeholder = 'Select...',
  accentColor = '#6366F1',
  style,
}) {
  const colors  = useColors();
  const C       = useMemo(() => ({
    bg:      colors.surface.card,
    raised:  colors.surface.elevated,
    border:  colors.border.light,
    textPri: colors.text.primary,
    textSec: colors.text.secondary,
    textMut: colors.text.muted,
  }), [colors]);
  const styles  = useMemo(() => makeStyles(C), [C]);

  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);

  return (
    <>
      <TouchableOpacity
        style={[styles.btn, { borderColor: `${accentColor}50` }, style]}
        onPress={() => setOpen(true)}
        activeOpacity={0.8}
      >
        <View style={[styles.btnDot, { backgroundColor: accentColor }]} />
        <Text style={styles.btnText} numberOfLines={1}>
          {selected?.label || placeholder}
        </Text>
        <Icon name="chevron-down" size={18} color={C.textSec} />
      </TouchableOpacity>

      <Modal
        visible={open}
        transparent
        animationType="slide"
        onRequestClose={() => setOpen(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setOpen(false)}
        >
          <View style={styles.sheet} onStartShouldSetResponder={() => true}>
            <View style={styles.handle} />

            <ScrollView
              bounces={false}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.sheetContent}
            >
              {options.map((opt) => {
                const active = opt.value === value;
                return (
                  <TouchableOpacity
                    key={String(opt.value)}
                    style={[styles.option, active && { backgroundColor: `${accentColor}18` }]}
                    onPress={() => { onChange(opt.value); setOpen(false); }}
                    activeOpacity={0.75}
                  >
                    {opt.icon ? (
                      <Icon
                        name={opt.icon}
                        size={18}
                        color={active ? accentColor : C.textSec}
                        style={styles.optionIcon}
                      />
                    ) : (
                      <View style={[styles.optionDot, { backgroundColor: active ? accentColor : C.textMut }]} />
                    )}
                    <Text
                      style={[styles.optionText, active && { color: accentColor, fontWeight: '700' }]}
                      numberOfLines={1}
                    >
                      {opt.label}
                    </Text>
                    {active && (
                      <Icon name="check-circle" size={18} color={accentColor} />
                    )}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const makeStyles = (C) => StyleSheet.create({
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.bg,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    gap: 10,
  },
  btnDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    flexShrink: 0,
  },
  btnText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: C.textPri,
  },

  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.6)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: C.bg,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: 1,
    borderColor: C.border,
    maxHeight: '65%',
    paddingBottom: 28,
  },
  handle: {
    width: 38,
    height: 4,
    backgroundColor: C.border,
    borderRadius: 2,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  sheetContent: { paddingBottom: 8 },

  option: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 15,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  optionIcon: { marginRight: 12 },
  optionDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 12,
    flexShrink: 0,
  },
  optionText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: C.textPri,
  },
});
