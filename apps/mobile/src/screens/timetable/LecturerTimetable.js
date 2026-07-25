import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  StatusBar,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { getLessonTypeByName } from '../../utils/constants';

import colors from '../../theme/colors';
import { useColors } from '../../theme';

const C = {
  purple:      colors.purple.main,
  success:     colors.success.main,
  danger:      colors.danger.main,
  warning:     colors.warning.main,
  info:        colors.info.main,
  pink:        colors.pink.main,
  textMuted:   colors.text.muted,
};


// Helper function to parse unit string
const parseUnit = (unitString) => {
  const match = unitString.match(/^(.+?)\s*\(([^)]+)\)$/);
  if (match) {
    return { name: match[1].trim(), code: match[2].trim() };
  }
  return { name: unitString, code: '' };
};

// Transform units data into lecturer format
const transformUnitsData = () => {
  const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
  const colors = [C.info, C.success, C.purple, C.warning, C.danger, C.pink, '#06B6D4', '#F97316'];
  const rooms = ['Lab 1', 'Lab 2', 'Lecture Hall A', 'Lecture Hall B', 'Seminar Room 101', 'Research Lab 3'];
  const times = ['09:00 AM - 11:00 AM', '11:00 AM - 01:00 PM', '02:00 PM - 04:00 PM', '10:00 AM - 12:00 PM'];
  const types = ['LEC', 'TUT', 'LAB', 'SEM', 'WRK', 'GD'];
  
  const allUnits = [];
  let colorIndex = 0;
  let dayIndex = 0;
  
  Object.entries(unitsByYearSemester).forEach(([yearSem, units]) => {
    units.forEach((unitString) => {
      const { name, code } = parseUnit(unitString);
      const [year, semester] = yearSem.split('-');
      
      allUnits.push({
        id: code,
        name: name,
        day: days[dayIndex % days.length],
        time: times[Math.floor(Math.random() * times.length)],
        enrolled: Math.floor(Math.random() * 30) + 20,
        room: rooms[Math.floor(Math.random() * rooms.length)],
        duration: '2 hours',
        type: types[colorIndex % types.length],
        color: colors[colorIndex % colors.length],
        attendance: Math.floor(Math.random() * 15) + 80,
        lastWeekAttendance: Math.floor(Math.random() * 15) + 80,
        trend: Math.random() > 0.3 ? 'up' : 'down',
        category: `Year ${year} - Sem ${semester}`
      });
      
      colorIndex++;
      dayIndex++;
    });
  });
  
  return allUnits;
};

// Single lecturer data with attendance percentages
const lecturer = {
  id: 'L001',
  name: 'Dr. Sarah Johnson',
  title: 'Professor of Biotechnology',
  department: 'School of Biological Sciences',
  email: 's.johnson@university.edu',
  phone: '+1 (555) 123-4567',
  office: 'HRD 301',
  officeHours: 'Mon, Wed 2:00 PM - 4:00 PM',
  units: transformUnitsData(),
  get totalStudents() {
    return this.units.reduce((sum, unit) => sum + unit.enrolled, 0);
  },
  get overallAttendance() {
    return this.units.reduce((sum, unit) => sum + unit.attendance, 0) / this.units.length;
  },
  lastWeekOverall: 88.3,
};

const daysOfWeek = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];

const UnitCard = ({ unit }) => {
  const getTrendIcon = (trend) => {
    switch(trend) {
      case 'up': return '↑';
      case 'down': return '↓';
      default: return '→';
    }
  };

  const getAttendanceColor = (attendance) => {
    if (attendance >= 90) return C.success;
    if (attendance >= 80) return C.warning;
    return C.danger;
  };

  const attendanceColor = getAttendanceColor(unit.attendance);
  const trendIcon = getTrendIcon(unit.trend);
  const trendColor = unit.trend === 'up' ? C.success : unit.trend === 'down' ? C.danger : C.textMuted;

  return (
    <View style={[styles.unitCard, { borderLeftColor: unit.color }]}>
      <View style={styles.unitHeader}>
        <View style={styles.unitIdContainer}>
          <Text style={styles.unitId}>{unit.id}</Text>
          <View style={[styles.categoryBadge, { backgroundColor: unit.color + '20' }]}>
            <Text style={[styles.categoryText, { color: unit.color }]}>{unit.category}</Text>
          </View>
        </View>
        <View style={styles.enrollmentBadge}>
          <Text style={styles.enrollmentText}>{unit.enrolled} students</Text>
        </View>
      </View>
      
      <Text style={styles.unitName}>{unit.name}</Text>

      {/* Lesson type pill */}
      {(() => {
        const lt = getLessonTypeByName(unit.type);
        return (
          <View style={[styles.lessonTypePill, { backgroundColor: lt.color + '22', borderColor: lt.color }]}>
            <Text style={[styles.lessonTypePillText, { color: lt.color }]}>{lt.label}</Text>
          </View>
        );
      })()}

      <View style={styles.unitDetails}>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Day:</Text>
          <Text style={styles.detailValue}>{unit.day} • {unit.time}</Text>
        </View>
        <View style={styles.detailRow}>
          <Text style={styles.detailLabel}>Room:</Text>
          <Text style={styles.detailValue}>{unit.room}</Text>
        </View>
      </View>
      
      {/* Attendance Section */}
      <View style={styles.attendanceSection}>
        <View style={styles.attendanceHeader}>
          <Text style={styles.attendanceLabel}>Attendance</Text>
          <View style={styles.attendanceTrend}>
            <Text style={[styles.trendIcon, { color: trendColor }]}>{trendIcon}</Text>
            <Text style={[styles.trendText, { color: trendColor }]}>
              {Math.abs(unit.attendance - unit.lastWeekAttendance).toFixed(1)}%
            </Text>
            <Text style={styles.lastWeekText}> from last week</Text>
          </View>
        </View>
        
        <View style={styles.attendanceBar}>
          <View 
            style={[
              styles.attendanceFill, 
              { 
                width: `${unit.attendance}%`,
                backgroundColor: attendanceColor 
              }
            ]} 
          />
        </View>
        
        <View style={styles.attendanceStats}>
          <View style={styles.attendanceStat}>
            <Text style={[styles.attendanceValue, { color: attendanceColor }]}>
              {unit.attendance.toFixed(1)}%
            </Text>
            <Text style={styles.attendanceStatLabel}>Current</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.attendanceStat}>
            <Text style={styles.lastWeekValue}>{unit.lastWeekAttendance.toFixed(1)}%</Text>
            <Text style={styles.attendanceStatLabel}>Last Week</Text>
          </View>
          <View style={styles.statDivider} />
          <View style={styles.attendanceStat}>
            <Text style={styles.durationValue}>{unit.duration}</Text>
            <Text style={styles.attendanceStatLabel}>Duration</Text>
          </View>
        </View>
      </View>
    </View>
  );
};

const DaySection = ({ day, units }) => {
  const dayUnits = units.filter(unit => unit.day === day);
  const totalEnrolled = dayUnits.reduce((sum, unit) => sum + unit.enrolled, 0);
  const avgAttendance = dayUnits.length > 0 
    ? (dayUnits.reduce((sum, unit) => sum + unit.attendance, 0) / dayUnits.length).toFixed(1)
    : 0;

  return (
    <View style={styles.daySection}>
      <View style={styles.dayHeader}>
        <View>
          <Text style={styles.dayTitle}>{day}</Text>
          <Text style={styles.daySubtitle}>
            {dayUnits.length} unit{dayUnits.length !== 1 ? 's' : ''} • {totalEnrolled} students
          </Text>
        </View>
        <View style={styles.dayStats}>
          <Text style={styles.dayAttendance}>{avgAttendance}%</Text>
          <Text style={styles.dayAttendanceLabel}>Avg Attendance</Text>
        </View>
      </View>
      
      {dayUnits.length > 0 ? (
        <View style={styles.unitsList}>
          {dayUnits.map((unit, index) => (
            <UnitCard 
              key={`${unit.id}-${index}`} 
              unit={unit}
            />
          ))}
        </View>
      ) : (
        <View style={styles.noUnits}>
          <Text style={styles.noUnitsText}>No classes scheduled</Text>
          <Text style={styles.noUnitsSubtext}>Office hours or research day</Text>
        </View>
      )}
    </View>
  );
};

const AttendanceOverview = ({ units }) => {
  const totalEnrolled = units.reduce((sum, unit) => sum + unit.enrolled, 0);
  const totalAttendance = units.reduce((sum, unit) => sum + unit.attendance, 0);
  const avgAttendance = totalAttendance / units.length;
  
  // Calculate attendance by category
  const categoryStats = {};
  units.forEach(unit => {
    if (!categoryStats[unit.category]) {
      categoryStats[unit.category] = { total: 0, count: 0 };
    }
    categoryStats[unit.category].total += unit.attendance;
    categoryStats[unit.category].count += 1;
  });

  return (
    <View style={styles.overviewCard}>
      <Text style={styles.overviewTitle}>Attendance Overview</Text>
      
      <View style={styles.overviewStats}>
        <View style={styles.overviewStat}>
          <Text style={styles.overviewValue}>{avgAttendance.toFixed(1)}%</Text>
          <Text style={styles.overviewLabel}>Overall Average</Text>
        </View>
        <View style={styles.statDividerVertical} />
        <View style={styles.overviewStat}>
          <Text style={styles.overviewValue}>{totalEnrolled}</Text>
          <Text style={styles.overviewLabel}>Total Students</Text>
        </View>
        <View style={styles.statDividerVertical} />
        <View style={styles.overviewStat}>
          <Text style={styles.overviewValue}>{units.length}</Text>
          <Text style={styles.overviewLabel}>Units</Text>
        </View>
      </View>
      
      <View style={styles.categoryStats}>
        <Text style={styles.categoryTitle}>By Category</Text>
        {Object.entries(categoryStats).map(([category, stats]) => {
          const avg = stats.total / stats.count;
          const color = avg >= 90 ? C.success : avg >= 80 ? C.warning : C.danger;
          
          return (
            <View key={category} style={styles.categoryRow}>
              <Text style={styles.categoryName}>{category}</Text>
              <View style={styles.categoryBarContainer}>
                <View 
                  style={[
                    styles.categoryBar, 
                    { width: `${avg}%`, backgroundColor: color }
                  ]} 
                />
              </View>
              <Text style={[styles.categoryValue, { color }]}>{avg.toFixed(1)}%</Text>
            </View>
          );
        })}
      </View>
    </View>
  );
};

export default function LecturerTimetable() {
  const themeColors = useColors();
  const C = useMemo(() => ({
    bg:        themeColors.background.primary,
    bgSec:     themeColors.background.secondary,
    surface:   themeColors.surface.primary,
    border:    themeColors.border.light,
    primary:   themeColors.primary.main,
    primaryD:  themeColors.primary.dark,
    success:   themeColors.success.main,
    warning:   themeColors.warning.main,
    danger:    themeColors.danger.main,
    text:      themeColors.text.primary,
    textSec:   themeColors.text.secondary,
    textTer:   themeColors.text.muted,
    // legacy aliases used by sub-components and styles
    info:      themeColors.info.main,
    purple:    themeColors.purple.main,
    pink:      themeColors.pink.main,
    textMuted: themeColors.text.muted,
  }), [themeColors]);
  const styles = useMemo(() => makeStyles(C), [C]);

  const [searchQuery, setSearchQuery] = useState('');
  
  const filteredUnits = lecturer.units.filter(unit =>
    unit.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    unit.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
    unit.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFFFF" />
      
      <ScrollView 
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerTop}>
            <Text style={styles.headerTitle}>My Teaching Schedule</Text>
            <Text style={styles.headerSubtitle}>Units, Enrollment & Attendance</Text>
          </View>
          
          {/* Search Bar */}
          <View style={styles.searchContainer}>
            <TextInput
              style={styles.searchBar}
              placeholder="Search units by name, code, or category..."
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholderTextColor="#666"
            />
            {searchQuery.length > 0 && (
              <TouchableOpacity 
                style={styles.clearButton}
                onPress={() => setSearchQuery('')}
              >
                <Text style={styles.clearButtonText}>✕</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
        
        {/* Lecturer Profile */}
        <View style={styles.profileSection}>
          <View style={styles.profileHeader}>
            <View style={styles.profileInfo}>
              <View style={styles.profileAvatar}>
                <Text style={styles.avatarText}>
                  {lecturer.name.split(' ').map(n => n[0]).join('')}
                </Text>
              </View>
              <View style={styles.profileDetails}>
                <Text style={styles.profileName}>{lecturer.name}</Text>
                <Text style={styles.profileTitle}>{lecturer.title}</Text>
                <View style={styles.profileMeta}>
                  <Text style={styles.profileDepartment}>{lecturer.department}</Text>
                  <Text style={styles.profileDivider}>•</Text>
                  <Text style={styles.profileOffice}>Office: {lecturer.office}</Text>
                </View>
              </View>
            </View>
          </View>
          
          <View style={styles.contactInfo}>
            <View style={styles.contactRow}>
              <View style={styles.contactItem}>
                <Text style={styles.contactLabel}>Email:</Text>
                <Text style={styles.contactValue}>{lecturer.email}</Text>
              </View>
              <View style={styles.contactItem}>
                <Text style={styles.contactLabel}>Phone:</Text>
                <Text style={styles.contactValue}>{lecturer.phone}</Text>
              </View>
            </View>
            <View style={styles.contactItem}>
              <Text style={styles.contactLabel}>Office Hours:</Text>
              <Text style={styles.contactValue}>{lecturer.officeHours}</Text>
            </View>
          </View>
          
          {/* Quick Stats */}
          <View style={styles.quickStats}>
            <View style={styles.quickStat}>
              <Text style={styles.quickStatNumber}>{lecturer.units.length}</Text>
              <Text style={styles.quickStatLabel}>Units Assigned</Text>
            </View>
            <View style={styles.quickStatDivider} />
            <View style={styles.quickStat}>
              <Text style={styles.quickStatNumber}>{lecturer.totalStudents}</Text>
              <Text style={styles.quickStatLabel}>Total Students</Text>
            </View>
            <View style={styles.quickStatDivider} />
            <View style={styles.quickStat}>
              <Text style={[styles.quickStatNumber, { color: C.success }]}>
                {lecturer.overallAttendance.toFixed(1)}%
              </Text>
              <Text style={styles.quickStatLabel}>Overall Attendance</Text>
            </View>
          </View>
        </View>
        
        {/* Attendance Overview */}
        <AttendanceOverview units={lecturer.units} />
        
        {/* Weekly Schedule */}
        <View style={styles.scheduleSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Weekly Schedule</Text>
            <Text style={styles.sectionSubtitle}>
              {lecturer.units.length} units • {lecturer.totalStudents} students
            </Text>
          </View>
          
          <View style={styles.daysContainer}>
            {daysOfWeek.map(day => (
              <DaySection
                key={day}
                day={day}
                units={searchQuery ? filteredUnits : lecturer.units}
              />
            ))}
          </View>
        </View>
        
        {/* Summary */}
        <View style={styles.summarySection}>
          <Text style={styles.summaryTitle}>Summary</Text>
          <View style={styles.summaryGrid}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryCardTitle}>Teaching Hours</Text>
              <Text style={styles.summaryCardValue}>
                {lecturer.units.reduce((total, unit) => {
                  const hours = parseInt(unit.duration);
                  return total + (isNaN(hours) ? 2 : hours);
                }, 0)} hrs/week
              </Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryCardTitle}>Avg Class Size</Text>
              <Text style={styles.summaryCardValue}>
                {Math.round(lecturer.totalStudents / lecturer.units.length)}
              </Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryCardTitle}>Attendance Trend</Text>
              <View style={styles.trendContainer}>
                <Text style={[styles.trendIcon, { color: lecturer.overallAttendance > lecturer.lastWeekOverall ? C.success : C.danger }]}>
                  {lecturer.overallAttendance > lecturer.lastWeekOverall ? '↑' : '↓'}
                </Text>
                <Text style={styles.summaryCardValue}>
                  {Math.abs(lecturer.overallAttendance - lecturer.lastWeekOverall).toFixed(1)}%
                </Text>
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const makeStyles = (C) => StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  scrollContent: {
    paddingBottom: 30,
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  headerTop: {
    marginBottom: 16,
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  headerSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchBar: {
    flex: 1,
    height: 48,
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 16,
    color: '#1A1A1A',
  },
  clearButton: {
    position: 'absolute',
    right: 12,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#E0E0E0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearButtonText: {
    fontSize: 12,
    color: '#666',
    fontWeight: '600',
  },
  profileSection: {
    backgroundColor: '#FFFFFF',
    margin: 16,
    marginTop: 16,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  profileHeader: {
    marginBottom: 16,
  },
  profileInfo: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  profileAvatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: C.info,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  avatarText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  profileDetails: {
    flex: 1,
  },
  profileName: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  profileTitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 8,
  },
  profileMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  profileDepartment: {
    fontSize: 13,
    color: C.info,
    fontWeight: '600',
  },
  profileDivider: {
    fontSize: 12,
    color: '#999',
    marginHorizontal: 8,
  },
  profileOffice: {
    fontSize: 13,
    color: '#666',
  },
  contactInfo: {
    marginBottom: 20,
  },
  contactRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  contactItem: {
    flex: 1,
  },
  contactLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
    marginBottom: 2,
  },
  contactValue: {
    fontSize: 14,
    color: '#1A1A1A',
  },
  quickStats: {
    flexDirection: 'row',
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    justifyContent: 'space-around',
  },
  quickStat: {
    alignItems: 'center',
    flex: 1,
  },
  quickStatNumber: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  quickStatLabel: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  quickStatDivider: {
    width: 1,
    height: '100%',
    backgroundColor: '#E0E0E0',
  },
  overviewCard: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  overviewTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 20,
  },
  overviewStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    marginBottom: 24,
  },
  overviewStat: {
    alignItems: 'center',
    flex: 1,
  },
  overviewValue: {
    fontSize: 24,
    fontWeight: '700',
    color: C.info,
    marginBottom: 4,
  },
  overviewLabel: {
    fontSize: 12,
    color: '#666',
    textAlign: 'center',
  },
  statDividerVertical: {
    width: 1,
    height: '100%',
    backgroundColor: '#E0E0E0',
  },
  categoryStats: {
    marginTop: 8,
  },
  categoryTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 16,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  categoryName: {
    fontSize: 14,
    color: '#666',
    width: 100,
  },
  categoryBarContainer: {
    flex: 1,
    height: 8,
    backgroundColor: '#F0F0F0',
    borderRadius: 4,
    marginHorizontal: 12,
    overflow: 'hidden',
  },
  categoryBar: {
    height: '100%',
    borderRadius: 4,
  },
  categoryValue: {
    fontSize: 14,
    fontWeight: '600',
    width: 60,
    textAlign: 'right',
  },
  scheduleSection: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  sectionHeader: {
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 4,
  },
  sectionSubtitle: {
    fontSize: 14,
    color: '#666',
  },
  daysContainer: {
    gap: 20,
  },
  daySection: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
  },
  dayHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  dayTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
  },
  daySubtitle: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  dayStats: {
    alignItems: 'center',
  },
  dayAttendance: {
    fontSize: 20,
    fontWeight: '700',
    color: C.info,
  },
  dayAttendanceLabel: {
    fontSize: 11,
    color: '#666',
    marginTop: 2,
  },
  unitsList: {
    gap: 12,
  },
  noUnits: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: 40,
  },
  noUnitsText: {
    fontSize: 14,
    color: '#666',
    marginBottom: 4,
  },
  noUnitsSubtext: {
    fontSize: 12,
    color: '#999',
  },
  unitCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  unitHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  unitIdContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
  },
  unitId: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1A1A1A',
    marginRight: 8,
  },
  categoryBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  categoryText: {
    fontSize: 11,
    fontWeight: '600',
  },
  enrollmentBadge: {
    backgroundColor: '#E0F2FE',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  enrollmentText: {
    fontSize: 11,
    color: '#0369A1',
    fontWeight: '600',
  },
  unitName: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 12,
  },
  unitDetails: {
    marginBottom: 16,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
  },
  detailLabel: {
    fontSize: 13,
    color: '#666',
    marginRight: 8,
    width: 50,
  },
  detailValue: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A1A1A',
    flex: 1,
  },
  lessonTypePill: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 10,
    borderWidth: 1,
    marginBottom: 10,
  },
  lessonTypePillText: {
    fontSize: 12,
    fontWeight: '700',
  },
  attendanceSection: {
    backgroundColor: '#F8F9FA',
    borderRadius: 8,
    padding: 12,
  },
  attendanceHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  attendanceLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1A1A1A',
  },
  attendanceTrend: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  trendIcon: {
    fontSize: 12,
    fontWeight: '700',
    marginRight: 4,
  },
  trendText: {
    fontSize: 11,
    fontWeight: '600',
    marginRight: 2,
  },
  lastWeekText: {
    fontSize: 11,
    color: '#666',
  },
  attendanceBar: {
    height: 6,
    backgroundColor: '#E0E0E0',
    borderRadius: 3,
    marginBottom: 12,
    overflow: 'hidden',
  },
  attendanceFill: {
    height: '100%',
    borderRadius: 3,
  },
  attendanceStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  attendanceStat: {
    alignItems: 'center',
    flex: 1,
  },
  attendanceValue: {
    fontSize: 16,
    fontWeight: '700',
    marginBottom: 2,
  },
  lastWeekValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 2,
  },
  durationValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1A1A1A',
    marginBottom: 2,
  },
  attendanceStatLabel: {
    fontSize: 11,
    color: '#666',
  },
  statDivider: {
    width: 1,
    height: '100%',
    backgroundColor: '#E0E0E0',
  },
  summarySection: {
    backgroundColor: '#FFFFFF',
    marginHorizontal: 16,
    marginBottom: 30,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  summaryTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1A1A1A',
    marginBottom: 20,
  },
  summaryGrid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  summaryCard: {
    backgroundColor: '#F8F9FA',
    borderRadius: 12,
    padding: 16,
    flex: 1,
    marginHorizontal: 4,
    alignItems: 'center',
  },
  summaryCardTitle: {
    fontSize: 12,
    color: '#666',
    marginBottom: 8,
    textAlign: 'center',
  },
  summaryCardValue: {
    fontSize: 20,
    fontWeight: '700',
    color: C.info,
  },
  trendContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
});