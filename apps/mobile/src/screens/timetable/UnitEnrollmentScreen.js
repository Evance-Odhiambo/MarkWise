// FILE: C:\Users\evanc\Desktop\TrueMark\src\screens\timetable\UnitEnrollmentScreen.js
import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  Modal,
  TextInput,
  StatusBar,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useEnrollment } from '../../context/EnrollmentContext';
import { fetchUnitsByYearSemester, resolveApiBaseUrl } from '../../utils/unitsApi';
import { getStudentSession } from '../../utils/authSession';
import OfflineBanner from '../../components/OfflineBanner';

import { useColors, useTheme } from '../../theme';

export default function UnitEnrollmentScreen() {
  const colors = useColors();
  const { isDark } = useTheme();
  const C = useMemo(() => ({
    primary:     colors.info.main,
    primaryDk:   colors.info.dark,
    success:     colors.success.main,
    successDk:   colors.success.dark,
    successSoft: colors.success.soft,
    danger:      colors.danger.main,
    warning:     colors.warning.main,
    warningSoft: colors.warning.soft,
    text:        colors.text.primary,
    textSec:     colors.text.secondary,
    surface:     colors.surface.primary,
    bg:          colors.background.primary,
    bgSec:       colors.background.secondary,
    border:      colors.border.light,
    borderMed:   colors.border.medium,
  }), [colors]);
  const styles = useMemo(() => makeStyles(C), [C]);

  const {
    enrolledUnits,
    setEnrolledUnits,
    toggleUnit,
    enrollAllUnits,
    clearAllUnits,
    updateUnitNamesMap,
    selectedYear,
    setSelectedYear,
    selectedSemester,
    setSelectedSemester,
    syncEnrollment,
  } = useEnrollment();

  const [isSaving, setIsSaving] = useState(false);
  const [saveStatus, setSaveStatus] = useState(null); // null | 'saved' | 'error'

  const [showYearPicker, setShowYearPicker] = useState(false);
  const [showSemesterPicker, setShowSemesterPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [actionType, setActionType] = useState('');
  const [unitsMap, setUnitsMap] = useState({});
  const [isLoadingUnits, setIsLoadingUnits] = useState(false);
  const [unitsFetchError, setUnitsFetchError] = useState('');

  const key = `${selectedYear}-${selectedSemester}`;
  const units = unitsMap[key] || [];

  const filteredUnits = units.filter(unit => {
    const q = searchQuery.toLowerCase();
    return unit.toLowerCase().includes(q);
  });

  const isUnitsMapEmpty = (map) => {
    if (!map || typeof map !== 'object') {
      return true;
    }
    return Object.keys(map).length === 0;
  };

  const resolveSessionCourseInfo = async () => {
    const session = await getStudentSession();
    return {
      courseId: String(session?.programId || session?.courseId || '').trim(),
      courseCode: String(session?.courseCode || '').trim(),
    };
  };

  const loadUnitsFromBackend = async () => {
    setIsLoadingUnits(true);
    setUnitsFetchError('');

    try {
      const { courseId, courseCode } = await resolveSessionCourseInfo();
      if (!courseId && !courseCode) {
        throw new Error('No course is linked to your student account. Please contact support.');
      }

      const remoteUnits = await fetchUnitsByYearSemester({ courseId, courseCode });
      if (isUnitsMapEmpty(remoteUnits)) {
        throw new Error(
          `No units returned for your course.`
        );
      }

      const allowedUnits = new Set(
        Object.values(remoteUnits)
          .flat()
          .map((unit) => getUnitCode(String(unit || '').trim()))
          .filter(Boolean)
      );

      // Build a space-insensitive lookup so "SCH2170" and "SCH 2170" are treated
      // as the same unit — prevents a backend/course-API format mismatch from
      // silently wiping a student's restored enrollment.
      const normalizedAllowedSet = new Set(
        [...allowedUnits].map(normalizeCodeCompare)
      );

      setEnrolledUnits((previous) =>
        previous.filter((unit) => normalizedAllowedSet.has(normalizeCodeCompare(unit)))
      );

      setUnitsMap(remoteUnits);
    } catch (error) {
      setUnitsMap({});
      setUnitsFetchError(
        `Failed to load units for your course from ${resolveApiBaseUrl()} (${error?.message || 'unknown error'}).`
      );
      console.warn('Failed to fetch course-scoped units from backend', error);
    } finally {
      setIsLoadingUnits(false);
    }
  };

  useEffect(() => {
    loadUnitsFromBackend();
  }, []);

  const handleSelectAll = () => {
    setActionType('enrollAll');
    setShowConfirmModal(true);
  };

  const handleClearAll = () => {
    setActionType('clearAll');
    setShowConfirmModal(true);
  };

  const handleSave = useCallback(async () => {
    if (isSaving) return;
    setIsSaving(true);
    setSaveStatus(null);
    try {
      await syncEnrollment();
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus(null), 3000);
    } catch (err) {
      setSaveStatus('error');
      Alert.alert(
        'Save Failed',
        err.message || 'Could not save enrollment to the server. Your selections are saved locally.',
        [{ text: 'OK' }],
      );
    } finally {
      setIsSaving(false);
    }
  }, [isSaving, syncEnrollment]);

  const confirmAction = () => {
    if (actionType === 'enrollAll') {
      const allNamesMap = {};
      units.forEach(u => { allNamesMap[getUnitCode(u)] = getUnitName(u); });
      updateUnitNamesMap(allNamesMap);
      enrollAllUnits(units.map(getUnitCode));
    } else if (actionType === 'clearAll') {
      clearAllUnits();
    }
    setShowConfirmModal(false);
    // Auto-sync to backend after bulk action
    setTimeout(() => handleSave(), 300);
  };

  const getUnitCode = (unitName) => {
    // Extract code from "Unit Name (CODE)" format
    const match = unitName.match(/\(([^)]+)\)/);
    const raw = match ? match[1] : unitName;
    // Preserve single internal spaces (e.g. "SCH 2170" stays "SCH 2170") but uppercase everything
    return raw.trim().replace(/\s+/g, ' ').toUpperCase();
  };

  // Normalize a code for comparison purposes (strip spaces, uppercase)
  const normalizeCodeCompare = (code) =>
    String(code || '').replace(/\s+/g, '').toUpperCase();

  const toTitleCase = (str) =>
    str.toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());

  // Insert a space before a run of uppercase letters that is followed by
  // a lowercase letter (handles "ORGANICChemistry" edge cases) — primarily
  // ensures that a name like "ORGANIC CHEMISTRY" (already spaced) works, while
  // a backend value with no spaces at least gets capitalized sensibly.
  const normalizeUnitName = (str) => {
    if (!str) return '';
    // If the name has spaces it's already correctly formatted — just title-case
    if (/\s/.test(str)) return toTitleCase(str);
    // All-caps no-spaces: could be a code like "ORGANICCHEMISTRY" stored as a
    // name.  We can't reliably split it so return title-case of the whole token
    // (better than raw ALL CAPS).
    return toTitleCase(str);
  };

  const getUnitName = (unitName) => {
    // Only extract a human-readable name when the entry has the "Name (CODE)" format.
    // If there are no parentheses, the whole string is just a code — return '' so we
    // don't title-case the code and display it again as if it were a name.
    const hasParens = /\([^)]+\)/.test(unitName);
    if (!hasParens) return '';
    const name = unitName.replace(/\s*\([^)]+\)\s*/, '').trim();
    return normalizeUnitName(name);
  };

  // Year Picker Modal
  const YearPicker = () => (
    <Modal
      visible={showYearPicker}
      transparent={true}
      animationType="slide"
      onRequestClose={() => setShowYearPicker(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.pickerModal}>
          <Text style={styles.pickerTitle}>Select Year</Text>
          {[1, 2, 3, 4].map(year => (
            <TouchableOpacity
              key={year}
              style={[
                styles.pickerOption,
                selectedYear === year.toString() && styles.pickerOptionSelected,
              ]}
              onPress={() => {
                setSelectedYear(year.toString());
                setShowYearPicker(false);
              }}
            >
              <Text style={[
                styles.pickerOptionText,
                selectedYear === year.toString() && styles.pickerOptionTextSelected,
              ]}>
                Year {year}
              </Text>
              {selectedYear === year.toString() && (
                <Icon name="check" size={20} color={C.success} />
              )}
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.pickerCancel}
            onPress={() => setShowYearPicker(false)}
          >
            <Text style={styles.pickerCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  // Semester Picker Modal
  const SemesterPicker = () => (
    <Modal
      visible={showSemesterPicker}
      transparent={true}
      animationType="slide"
      onRequestClose={() => setShowSemesterPicker(false)}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.pickerModal}>
          <Text style={styles.pickerTitle}>Select Semester</Text>
          {[1, 2].map(sem => (
            <TouchableOpacity
              key={sem}
              style={[
                styles.pickerOption,
                selectedSemester === sem.toString() && styles.pickerOptionSelected,
              ]}
              onPress={() => {
                setSelectedSemester(sem.toString());
                setShowSemesterPicker(false);
              }}
            >
              <Text style={[
                styles.pickerOptionText,
                selectedSemester === sem.toString() && styles.pickerOptionTextSelected,
              ]}>
                Semester {sem}
              </Text>
              {selectedSemester === sem.toString() && (
                <Icon name="check" size={20} color={C.success} />
              )}
            </TouchableOpacity>
          ))}
          <TouchableOpacity
            style={styles.pickerCancel}
            onPress={() => setShowSemesterPicker(false)}
          >
            <Text style={styles.pickerCancelText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar backgroundColor={C.primary} barStyle={isDark ? 'light-content' : 'dark-content'} />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerContent}>
          <Text style={styles.headerTitle}>Unit Enrollment</Text>
          <Text style={styles.headerSubtitle}>
            Select your units for the semester
          </Text>
        </View>
        <View style={styles.enrollmentBadge}>
          <Text style={styles.enrollmentCount}>{enrolledUnits.length}</Text>
          <Text style={styles.enrollmentLabel}>Enrolled</Text>
        </View>
      </View>

      <OfflineBanner message="You are offline. Loading units requires internet." />

      {/* Filters Section */}
      <View style={styles.filtersSection}>
        {/* Year/Semester Selectors */}
        <View style={styles.selectorRow}>
          <TouchableOpacity
            style={styles.selectorButton}
            onPress={() => setShowYearPicker(true)}
          >
            <Icon name="calendar" size={18} color={C.primary} />
            <Text style={styles.selectorText}>Year {selectedYear}</Text>
            <Icon name="chevron-down" size={18} color={C.textSec} />
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.selectorButton}
            onPress={() => setShowSemesterPicker(true)}
          >
            <Icon name="school" size={18} color={C.primary} />
            <Text style={styles.selectorText}>Semester {selectedSemester}</Text>
            <Icon name="chevron-down" size={18} color={C.textSec} />
          </TouchableOpacity>
        </View>

        {/* Search Bar */}
        <View style={styles.searchContainer}>
          <Icon name="magnify" size={20} color={C.textSec} />
          <TextInput
            style={styles.searchInput}
            placeholder="Search units..."
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholderTextColor={C.textSec}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery('')}>
              <Icon name="close-circle" size={20} color={C.textSec} />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Quick Actions */}
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={[styles.quickButton, styles.selectAllButton]}
          onPress={handleSelectAll}
        >
          <Icon name="check-all" size={18} color="#FFFFFF" />
          <Text style={styles.quickButtonText}>Select All</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.quickButton, styles.clearButton]}
          onPress={handleClearAll}
        >
          <Icon name="close-box" size={18} color="#FFFFFF" />
          <Text style={styles.quickButtonText}>Clear All</Text>
        </TouchableOpacity>
      </View>

      {isLoadingUnits && (
        <View style={styles.loadingOverlay}>
          <View style={styles.loadingCard}>
            <ActivityIndicator size="large" color={C.primary} />
            <Text style={styles.loadingCardText}>Loading units…</Text>
          </View>
        </View>
      )}

      {!isLoadingUnits && unitsFetchError ? (
        <View style={styles.syncBanner}>
          <Text style={styles.syncBannerText}>{unitsFetchError}</Text>
          <TouchableOpacity onPress={loadUnitsFromBackend}>
            <Text style={styles.syncRetryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {/* Units List */}
      <ScrollView
        style={styles.unitsList}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.unitsListContent}
      >
        {filteredUnits.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="book-off" size={60} color={C.border} />
            <Text style={styles.emptyStateText}>
              {searchQuery ? 'No units found' : 'No units available'}
            </Text>
            {searchQuery && (
              <TouchableOpacity
                style={styles.clearSearchButton}
                onPress={() => setSearchQuery('')}
              >
                <Text style={styles.clearSearchText}>Clear Search</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            <View style={styles.unitsHeader}>
              <Text style={styles.unitsCount}>
                {filteredUnits.length} unit{filteredUnits.length !== 1 ? 's' : ''} available
              </Text>
            </View>

            {filteredUnits.map((unit, index) => {
              const unitCode = getUnitCode(unit);
              // Normalize comparison so previously stored codes (space-stripped) still match
              const isEnrolled = enrolledUnits.some(eu => normalizeCodeCompare(eu) === normalizeCodeCompare(unitCode));
              const unitName = getUnitName(unit);

              return (
                <TouchableOpacity
                  key={index}
                  style={[
                    styles.unitCard,
                    isEnrolled && styles.unitCardSelected,
                  ]}
                  onPress={() => {
                    updateUnitNamesMap({ [unitCode]: unitName });
                    toggleUnit(unitCode);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.unitCheckbox}>
                    <View style={[
                      styles.checkbox,
                      isEnrolled && styles.checkboxChecked,
                    ]}>
                      {isEnrolled && (
                        <Icon name="check" size={14} color="#FFFFFF" />
                      )}
                    </View>
                  </View>

                  <View style={styles.unitContent}>
                    <View style={styles.unitHeader}>
                      <Text style={styles.unitCode}>{unitCode}</Text>
                      <View style={[
                        styles.statusBadge,
                        isEnrolled ? styles.statusEnrolled : styles.statusAvailable,
                      ]}>
                        <Text style={styles.statusText}>
                          {isEnrolled ? 'Enrolled' : 'Available'}
                        </Text>
                      </View>
                    </View>

                    <Text style={styles.unitName} numberOfLines={2}>
                      {unitName}
                    </Text>

                    <View style={styles.unitMeta}>
                      <View style={styles.metaItem}>
                        <Icon name="clock-outline" size={12} color={C.textSec} />
                      </View>
                      <View style={styles.metaItem}>
                        <Icon name="calendar" size={12} color={C.textSec} />
                        <Text style={styles.metaText}>Sem {selectedSemester}</Text>
                      </View>
                    </View>
                  </View>
                </TouchableOpacity>
              );
            })}
          </>
        )}
      </ScrollView>

      {/* Enrollment Summary */}
      {enrolledUnits.length > 0 && (
        <View style={styles.summaryBar}>
          <View style={styles.summaryContent}>
            <View style={styles.summaryTexts}>
              <Text style={styles.summaryCount}>
                {enrolledUnits.length} unit{enrolledUnits.length !== 1 ? 's' : ''} selected
              </Text>
            </View>
            <TouchableOpacity
              style={[styles.saveButton, (isSaving || saveStatus === 'saved') && { opacity: 0.8 }]}
              onPress={handleSave}
              disabled={isSaving}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#FFFFFF" />
              ) : (
                <Icon
                  name={saveStatus === 'saved' ? 'check-circle' : saveStatus === 'error' ? 'alert-circle' : 'content-save'}
                  size={18}
                  color="#FFFFFF"
                />
              )}
              <Text style={styles.saveButtonText}>
                {isSaving ? 'Saving...' : saveStatus === 'saved' ? 'Saved!' : saveStatus === 'error' ? 'Retry' : 'Save'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* Modals */}
      <YearPicker />
      <SemesterPicker />

      {/* Confirmation Modal */}
      <Modal
        visible={showConfirmModal}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowConfirmModal(false)}
      >
        <View style={styles.confirmModalOverlay}>
          <View style={styles.confirmModal}>
            <Icon
              name={actionType === 'enrollAll' ? "check-circle" : "alert-circle"}
              size={48}
              color={actionType === 'enrollAll' ? C.success : C.danger}
              style={styles.confirmIcon}
            />

            <Text style={styles.confirmTitle}>
              {actionType === 'enrollAll' ? 'Enroll All Units?' : 'Clear All Enrollments?'}
            </Text>

            <Text style={styles.confirmMessage}>
              {actionType === 'enrollAll'
                ? `This will enroll ${units.length} units for Year ${selectedYear}, Semester ${selectedSemester}.`
                : 'This will remove all enrolled units.'}
            </Text>

            <View style={styles.confirmButtons}>
              <TouchableOpacity
                style={[styles.confirmButton, styles.cancelButton]}
                onPress={() => setShowConfirmModal(false)}
              >
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[styles.confirmButton, styles.confirmActionButton]}
                onPress={confirmAction}
              >
                <Text style={styles.confirmActionButtonText}>
                  {actionType === 'enrollAll' ? 'Enroll All' : 'Clear All'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const makeStyles = (C) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: C.bg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 12,
    backgroundColor: C.surface,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  headerContent: {
    flex: 1,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: C.text,
  },
  headerSubtitle: {
    fontSize: 12,
    color: C.textSec,
    marginTop: 2,
  },
  enrollmentBadge: {
    backgroundColor: C.successSoft,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    alignItems: 'center',
    minWidth: 60,
  },
  enrollmentCount: {
    fontSize: 20,
    fontWeight: 'bold',
    color: C.success,
  },
  enrollmentLabel: {
    fontSize: 10,
    color: C.successDk,
    textTransform: 'uppercase',
    marginTop: 2,
  },
  filtersSection: {
    backgroundColor: C.surface,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  selectorRow: {
    flexDirection: 'row',
    marginBottom: 12,
  },
  selectorButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: C.bg,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    marginHorizontal: 4,
    borderWidth: 1,
    borderColor: C.border,
  },
  selectorText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
    marginHorizontal: 8,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.bg,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: C.border,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: C.text,
    marginLeft: 12,
    marginRight: 8,
  },
  quickActions: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(255,255,255,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 99,
  },
  loadingCard: {
    backgroundColor: C.surface,
    borderRadius: 16,
    paddingVertical: 28,
    paddingHorizontal: 40,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
    gap: 14,
  },
  loadingCardText: {
    fontSize: 14,
    fontWeight: '600',
    color: C.primaryDk,
  },
  syncBanner: {
    backgroundColor: C.warningSoft,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  syncBannerText: {
    color: C.warning,
    fontSize: 12,
    flex: 1,
    marginRight: 12,
  },
  syncRetryText: {
    color: C.danger,
    fontSize: 12,
    fontWeight: '700',
  },
  quickButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 10,
    borderRadius: 8,
    marginHorizontal: 6,
  },
  quickButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  selectAllButton: {
    backgroundColor: C.success,
  },
  clearButton: {
    backgroundColor: C.danger,
  },
  unitsList: {
    flex: 1,
  },
  unitsListContent: {
    padding: 12,
  },
  unitsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
    paddingHorizontal: 4,
  },
  unitsCount: {
    fontSize: 14,
    fontWeight: '600',
    color: C.text,
  },
  unitCard: {
    flexDirection: 'row',
    backgroundColor: C.surface,
    borderRadius: 12,
    padding: 14,
    marginBottom: 10,
    borderWidth: 1,
    borderColor: C.border,
  },
  unitCardSelected: {
    borderColor: C.success,
    backgroundColor: C.successSoft,
  },
  unitCheckbox: {
    justifyContent: 'center',
    marginRight: 12,
  },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: C.borderMed,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxChecked: {
    backgroundColor: C.success,
    borderColor: C.success,
  },
  unitContent: {
    flex: 1,
  },
  unitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  unitCode: {
    fontSize: 13,
    fontWeight: '600',
    color: C.success,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
  },
  statusEnrolled: {
    backgroundColor: C.successSoft,
  },
  statusAvailable: {
    backgroundColor: C.bgSec,
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
    color: C.text,
  },
  unitName: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    marginBottom: 8,
    lineHeight: 20,
  },
  unitMeta: {
    flexDirection: 'row',
  },
  metaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 16,
  },
  metaText: {
    fontSize: 12,
    color: C.textSec,
    marginLeft: 4,
  },
  emptyState: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
    minHeight: 300,
  },
  emptyStateText: {
    fontSize: 16,
    color: C.textSec,
    textAlign: 'center',
    marginTop: 16,
  },
  clearSearchButton: {
    marginTop: 16,
    paddingHorizontal: 20,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: C.primary,
  },
  clearSearchText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '500',
  },
  summaryBar: {
    backgroundColor: C.surface,
    padding: 16,
    borderTopWidth: 1,
    borderTopColor: C.border,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  summaryContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  summaryTexts: {
    flex: 1,
  },
  summaryCount: {
    fontSize: 16,
    fontWeight: '600',
    color: C.text,
    marginBottom: 2,
  },
  saveButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: C.success,
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 20,
  },
  saveButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 6,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  pickerModal: {
    backgroundColor: C.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 20,
    paddingBottom: 30,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: C.text,
    textAlign: 'center',
    marginBottom: 20,
  },
  pickerOption: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 20,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  pickerOptionSelected: {
    backgroundColor: C.successSoft,
  },
  pickerOptionText: {
    fontSize: 16,
    color: C.text,
  },
  pickerOptionTextSelected: {
    color: C.success,
    fontWeight: '600',
  },
  pickerCancel: {
    marginTop: 20,
    padding: 16,
    alignItems: 'center',
  },
  pickerCancelText: {
    fontSize: 16,
    color: C.danger,
    fontWeight: '600',
  },
  confirmModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  confirmModal: {
    backgroundColor: C.surface,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  confirmIcon: {
    marginBottom: 20,
  },
  confirmTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: C.text,
    textAlign: 'center',
    marginBottom: 12,
  },
  confirmMessage: {
    fontSize: 15,
    color: C.textSec,
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  confirmButtons: {
    flexDirection: 'row',
    width: '100%',
  },
  confirmButton: {
    flex: 1,
    padding: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 8,
  },
  cancelButton: {
    backgroundColor: C.bgSec,
  },
  cancelButtonText: {
    color: C.textSec,
    fontWeight: '600',
    fontSize: 16,
  },
  confirmActionButton: {
    backgroundColor: C.success,
  },
  confirmActionButtonText: {
    color: '#FFFFFF',
    fontWeight: '600',
    fontSize: 16,
  },
});
