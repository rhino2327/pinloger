import React, { useState, useEffect } from 'react';
import { View, Text, FlatList, TouchableOpacity, StyleSheet, ScrollView } from 'react-native';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { useUserProfile } from '../hooks/useUserProfile';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function MyScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [trips, setTrips] = useState([]);
  const { profile } = useUserProfile();
  const today = new Date().toISOString().slice(0, 10);
  const user = auth.currentUser;

  useEffect(() => {
    const q = query(collection(db, 'trips'), where('members', 'array-contains', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setTrips(snapshot.docs.map(d => ({ id: d.id, ...d.data() })));
    });
    return unsubscribe;
  }, []);

  const pastTrips = trips.filter(t => t.endDate && t.endDate < today)
    .sort((a, b) => b.endDate > a.endDate ? 1 : -1);
  const upcomingTrips = trips.filter(t => !t.endDate || t.endDate >= today)
    .sort((a, b) => (a.startDate || '') > (b.startDate || '') ? 1 : -1);

  const getDuration = (start, end) => {
    if (!start || !end) return '';
    return `${Math.round((new Date(end) - new Date(start)) / 86400000) + 1}일`;
  };

  const TripCard = ({ item, isPast }) => (
    <TouchableOpacity
      style={[styles.tripCard, isPast && styles.tripCardPast]}
      onPress={() => navigation.navigate('TripDetail', { trip: item })}
    >
      <Text style={styles.tripFlag}>{item.flag || '🌍'}</Text>
      <View style={styles.tripInfo}>
        <Text style={[styles.tripName, isPast && styles.tripNamePast]}>{item.name}</Text>
        <Text style={styles.tripDest}>📍 {item.destination}</Text>
        {item.startDate && (
          <Text style={styles.tripDate}>
            🗓 {item.startDate} ~ {item.endDate}{'  '}{getDuration(item.startDate, item.endDate)}
          </Text>
        )}
        <View style={styles.tagRow}>
          <View style={[styles.tag, isPast ? styles.tagPast : styles.tagUpcoming]}>
            <Text style={styles.tagText}>{isPast ? '✅ 완료' : '🔜 예정'}</Text>
          </View>
          <View style={styles.tag}>
            <Text style={styles.tagText}>
              {item.memberRoles?.[user.uid] === 'owner' ? '🚩 대표' : '👥 참여'}
            </Text>
          </View>
        </View>
      </View>
      <Text style={styles.arrow}>›</Text>
    </TouchableOpacity>
  );

  const listData = [
    { type: 'profile' },
    { type: 'stats' },
    ...(upcomingTrips.length > 0 ? [{ type: 'header', title: `🔜 예정된 여행 (${upcomingTrips.length})` }] : []),
    ...upcomingTrips.map(t => ({ type: 'trip', ...t, isPast: false })),
    ...(pastTrips.length > 0 ? [{ type: 'header', title: `✅ 지난 여행 (${pastTrips.length})` }] : []),
    ...pastTrips.map(t => ({ type: 'trip', ...t, isPast: true })),
    ...(trips.length === 0 ? [{ type: 'empty' }] : []),
  ];

  return (
    <FlatList
      style={styles.container}
      data={listData}
      keyExtractor={(item, i) => item.id || `${item.type}-${i}`}
      contentContainerStyle={[styles.list, { paddingTop: insets.top + 12 }]}
      renderItem={({ item }) => {
        if (item.type === 'profile') {
          return (
            <View style={styles.profileSection}>
              <TouchableOpacity
                style={styles.profileCard}
                onPress={() => navigation.navigate('Profile')}
              >
                <Text style={styles.profileAvatar}>{profile?.avatar || '✈️'}</Text>
                <View style={styles.profileInfo}>
                  <Text style={styles.profileName}>{profile?.nickname || '여행자'}</Text>
                  <Text style={styles.profileEmail}>{user?.email}</Text>
                  <Text style={styles.profileEditHint}>탭하여 프로필 수정 →</Text>
                </View>
              </TouchableOpacity>
            </View>
          );
        }
        if (item.type === 'stats') {
          return (
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{trips.length}</Text>
                <Text style={styles.statLabel}>총 여행</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{upcomingTrips.length}</Text>
                <Text style={styles.statLabel}>예정</Text>
              </View>
              <View style={styles.statCard}>
                <Text style={styles.statNum}>{pastTrips.length}</Text>
                <Text style={styles.statLabel}>완료</Text>
              </View>
            </View>
          );
        }
        if (item.type === 'header') return <Text style={styles.sectionHeader}>{item.title}</Text>;
        if (item.type === 'empty') return (
          <Text style={styles.emptyText}>아직 여행이 없어요.{'\n'}내 여행 탭에서 만들어보세요! ✈️</Text>
        );
        return <TripCard item={item} isPast={item.isPast} />;
      }}
    />
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  list: { paddingHorizontal: 20, paddingBottom: 40 },
  profileSection: { marginBottom: 16 },
  profileCard: {
    backgroundColor: '#16213e', borderRadius: 16, padding: 18,
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#0f3460',
  },
  profileAvatar: { fontSize: 52, marginRight: 16 },
  profileInfo: { flex: 1 },
  profileName: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 3 },
  profileEmail: { color: '#aaa', fontSize: 13, marginBottom: 4 },
  profileEditHint: { color: '#e94560', fontSize: 12 },
  statsRow: { flexDirection: 'row', gap: 10, marginBottom: 24 },
  statCard: {
    flex: 1, backgroundColor: '#16213e', borderRadius: 12, padding: 14,
    alignItems: 'center', borderWidth: 1, borderColor: '#0f3460',
  },
  statNum: { color: '#e94560', fontSize: 24, fontWeight: 'bold' },
  statLabel: { color: '#aaa', fontSize: 12, marginTop: 2 },
  sectionHeader: { color: '#aaa', fontSize: 13, fontWeight: 'bold', marginTop: 4, marginBottom: 10 },
  tripCard: {
    backgroundColor: '#16213e', borderRadius: 14, padding: 16,
    marginBottom: 12, flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#0f3460',
  },
  tripCardPast: { opacity: 0.7 },
  tripFlag: { fontSize: 34, marginRight: 14 },
  tripInfo: { flex: 1 },
  tripName: { color: '#fff', fontSize: 15, fontWeight: 'bold', marginBottom: 3 },
  tripNamePast: { color: '#bbb' },
  tripDest: { color: '#aaa', fontSize: 13, marginBottom: 3 },
  tripDate: { color: '#4a9eff', fontSize: 12, marginBottom: 5 },
  tagRow: { flexDirection: 'row', gap: 6 },
  tag: { backgroundColor: '#0f3460', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  tagUpcoming: { backgroundColor: 'rgba(74,158,255,0.2)' },
  tagPast: { backgroundColor: 'rgba(100,100,100,0.3)' },
  tagText: { color: '#aaa', fontSize: 11 },
  arrow: { color: '#aaa', fontSize: 24 },
  emptyText: { color: '#aaa', textAlign: 'center', marginTop: 40, fontSize: 15, lineHeight: 26 },
});
