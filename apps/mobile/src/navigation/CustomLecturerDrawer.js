import React, { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { DrawerContentScrollView, DrawerItemList } from '@react-navigation/drawer';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useColors } from '../theme';

const CustomLecturerDrawer = (props) => {
  const colors = useColors();
  const C = useMemo(() => ({
    primary: colors.primary.main,
    surface: colors.surface.primary,
  }), [colors]);
  const styles = useMemo(() => makeStyles(C), [C]);

  return (
    <DrawerContentScrollView {...props} contentContainerStyle={{ flex: 1, paddingTop: 0 }}>
      <View style={styles.headerContainer}>
        <Text style={styles.logoText}>MarkWise</Text>
        <View style={styles.userInfo}>
          <Icon name="account-circle" size={48} color="#fff" />
          <View style={{ marginLeft: 12 }}>
            <Text style={styles.userName}>{props?.userName || 'Lecturer'}</Text>
          </View>
        </View>
      </View>
      <View style={styles.drawerListContainer}>
        <DrawerItemList {...props} />
      </View>
    </DrawerContentScrollView>
  );
};

const makeStyles = (C) => StyleSheet.create({
  headerContainer: {
    backgroundColor: C.primary,
    paddingTop: 48,
    paddingBottom: 24,
    paddingHorizontal: 20,
    borderBottomLeftRadius: 32,
    borderBottomRightRadius: 32,
    elevation: 4,
  },
  logoText: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 2,
    marginBottom: 12,
    textAlign: 'center',
  },
  userInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 8,
  },
  userName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  drawerListContainer: {
    flex: 1,
    backgroundColor: C.surface,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: -16,
    paddingTop: 16,
    paddingHorizontal: 0,
  },
});

export default CustomLecturerDrawer;
