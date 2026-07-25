import React from 'react';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { View, StyleSheet, ScrollView, TouchableOpacity, Text } from 'react-native';
import OverviewScreen from '../screens/student/home/OverviewScreen';
import ProgressScreen from '../screens/student/home/ProgressScreen';
import AchievementsScreen from '../screens/student/home/AchievementsScreen';
import InsightsScreen from '../screens/student/home/InsightsScreen';
import HomeHeader from '../components/StudentHeader';



const Tab = createMaterialTopTabNavigator();


// Custom Tab Bar Component
const CustomTabBar = ({ state, descriptors, navigation }) => {
  return (
    <View style={styles.tabBarContainer}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tabBarScrollContent}
        style={styles.tabBarScroll}
      >
        {state.routes.map((route, index) => {
          const { options } = descriptors[route.key];
          const label = options.tabBarLabel || options.title || route.name;
          const isFocused = state.index === index;

          const onPress = () => {
            const event = navigation.emit({
              type: 'tabPress',
              target: route.key,
              canPreventDefault: true,
            });

            if (!isFocused && !event.defaultPrevented) {
              navigation.navigate(route.name);
            }
          };

          const onLongPress = () => {
            navigation.emit({
              type: 'tabLongPress',
              target: route.key,
            });
          };

          return (
            <TouchableOpacity
              key={route.key}
              accessibilityRole="button"
              accessibilityState={isFocused ? { selected: true } : {}}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarTestID}
              onPress={onPress}
              onLongPress={onLongPress}
              style={[
                styles.tabItem,
                isFocused && styles.activeTabItem,
              ]}
              activeOpacity={0.7}
            >
              <Text style={[
                styles.tabLabel,
                isFocused && styles.activeTabLabel,
              ]}>
                {label}
              </Text>
              {isFocused && <View style={styles.activeIndicator} />}
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
};

export default function HomeTopTabs({ role, studentName, studentEmail }) {
  return (
    <View style={styles.container}>
      <View style={styles.headerLayer}>
        <HomeHeader userName={studentName} userEmail={studentEmail} role={role} />
      </View>

      <View style={styles.tabsLayer}>
        <Tab.Navigator
          tabBar={(props) => <CustomTabBar {...props} />}
          sceneContainerStyle={styles.sceneContainer}
          screenOptions={{
            swipeEnabled: true,
          }}
        >
          <Tab.Screen name="Overview">
            {() => <OverviewScreen role={role} />}
          </Tab.Screen>          
          <Tab.Screen name="Progress">
            {() => <ProgressScreen role={role} />}
          </Tab.Screen>
          <Tab.Screen name="Achievements">
            {() => <AchievementsScreen role={role} />}
          </Tab.Screen>
          <Tab.Screen name="Insights">
            {() => <InsightsScreen role={role} />}
          </Tab.Screen>      
        </Tab.Navigator>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#edaeae',
  },
  headerLayer: {
    zIndex: 20,
    elevation: 20,
  },
  tabsLayer: {
    flex: 1,
    zIndex: 1,
    elevation: 1,
  },
  sceneContainer: {
    overflow: 'hidden',
    backgroundColor: '#0F0F1A',
  },
  tabBarContainer: {
    backgroundColor: '#ffffff',
    borderBottomWidth: 1,
    borderBottomColor: '#48d43e',
    height: 48,
  },
  tabBarScroll: {
    flex: 1,
  },
  tabBarScrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  tabItem: {
    paddingHorizontal: 6,
    paddingVertical: 2,
    marginRight: 1,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 40,
  },
  activeTabItem: {
   
  },
  tabLabel: {
    fontSize: 18,
    fontWeight: '500',
    color: '#95a5a6',
    textAlign: 'center',
    width: '100%',
  },
  activeTabLabel: {
    color: '#4CAF50',
    fontWeight: '800',
  },
  activeIndicator: {
    position: 'absolute',
    bottom: 0,
    left: 16,
    right: 16,
    height: 3,
    backgroundColor: '#37861b',
    borderRadius: 1.5,
  },
});