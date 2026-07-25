import React, { useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Platform,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/Ionicons';
import { getStudentSession } from '../utils/authSession';
import { useColors } from '../theme';



export default function HomeHeader({
  userName = '',
  role = 'Student',
  course = 'Computational Biology',
}) {
  const colors = useColors();
  const [sessionName, setSessionName] = useState('');
  const [sessionCourse, setSessionCourse] = useState('');
  const [sessionAdmission, setSessionAdmission] = useState('');

  useEffect(() => {
    let isMounted = true;
    const loadSession = async () => {
      const session = await getStudentSession();
      if (!isMounted || !session) {
        return;
      }
      setSessionName(session?.studentName || '');
      setSessionCourse(session?.courseName || session?.programName || '');
      setSessionAdmission(session?.admissionNumber || '');
    };

    loadSession();
    return () => {
      isMounted = false;
    };
  }, []);

  const displayName = useMemo(
    () => (userName || sessionName || 'Student').trim(),
    [userName, sessionName],
  );
  const displayCourse = useMemo(
    () => (sessionCourse || course).trim(),
    [sessionCourse, course],
  );
  const displayAdmission = useMemo(
    () => (sessionAdmission || '').trim(),
    [sessionAdmission],
  );

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return '🌅 Good Morning';
    if (hour < 18) return '☀️ Good Afternoon';
    return '🌙 Good Evening';
  };

  return (
    <LinearGradient
      colors={colors.primary.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 0 }}
      style={styles.container}
    >
      {/* Top Row - Greeting */}
      <View style={styles.topRow}>
        <View style={styles.greetingContainer}>
          <Icon name="sunny-outline" size={16} color="rgba(255,255,255,0.9)" />
          <Text style={styles.greeting}>{getGreeting()}</Text>
        </View>
      </View>

      {/* Student Info */}
      <View style={styles.infoContainer}>
        {/* Name and Role */}
        <View style={styles.nameSection}>
          <Text style={styles.name} numberOfLines={1}>
            {displayName}
          </Text>
          <View style={styles.roleBadge}>
            <Icon name="person-outline" size={12} color="#FFFFFF" />
            <Text style={styles.roleText}>{role}</Text>
          </View>
        </View>

        {/* Course and Admission Number */}
        <View style={styles.detailsSection}>
          <View style={styles.detailRow}>
            <View style={styles.detailItem}>
              <Icon name="school-outline" size={14} color="rgba(255,255,255,0.9)" />
              <Text style={styles.detailText} numberOfLines={1}>
                {displayCourse}
              </Text>
            </View>
            
            <View style={styles.separator} />
            
            <View style={styles.detailItem}>
              <Icon name="card-outline" size={14} color="rgba(255,255,255,0.9)" />
              <Text style={styles.detailText} numberOfLines={1}>
                {displayAdmission || 'Not Available'}
              </Text>
            </View>
          </View>
        </View>

        {/* Decorative Element */}
        <View style={styles.bottomDecoration}>
          <View style={styles.decorationLine} />
        </View>
      </View>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 30,
    paddingTop: Platform.OS === 'ios' ? 50 : 30,
    paddingHorizontal: 20,
    paddingBottom: 18,
    borderBottomLeftRadius: 25,
    borderBottomRightRadius: 25,
    overflow: 'hidden',
    shadowColor: '#764ba2',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 10,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 15,
  },
  greetingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  greeting: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
    marginLeft: 6,
  },
  infoContainer: {
    marginTop: 5,
  },
  nameSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  name: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#FFFFFF',
    flex: 1,
    marginRight: 12,
    textShadowColor: 'rgba(0,0,0,0.1)',
    textShadowOffset: { width: 1, height: 1 },
    textShadowRadius: 2,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  roleText: {
    fontSize: 12,
    color: '#FFFFFF',
    fontWeight: '600',
    marginLeft: 4,
  },
  detailsSection: {
    backgroundColor: 'rgba(255,255,255,0.1)',
    borderRadius: 15,
    padding: 14,
    marginBottom: 8,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  detailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  detailText: {
    fontSize: 14,
    color: '#FFFFFF',
    fontWeight: '500',
    marginLeft: 8,
    flex: 1,
    opacity: 0.95,
  },
  separator: {
    width: 1,
    height: 20,
    backgroundColor: 'rgba(255,255,255,0.3)',
    marginHorizontal: 15,
  },
  bottomDecoration: {
    alignItems: 'center',
    marginTop: 10,
  },
  decorationLine: {
    width: '30%',
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.4)',
    borderRadius: 2,
  },
});