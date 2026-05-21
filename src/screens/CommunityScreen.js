import React, { useState, useEffect } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet, Alert, Switch
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { generateInviteCode } from '../utils/helpers';

export default function CommunityScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [publicTrips, setPublicTrips] = useState([]);   // 남들 여행
  const [mySharedTrips, setMySharedTrips] = useState([]); // 내가 공유 중인 여행
  const user = auth.currentUser;

  // 남들 공개 여행
  useEffect(() => {
    const q = query(collection(db, 'trips'), where('isPublic', '==', true));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const all = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setPublicTrips(all.filter(t => t.ownerId !== user.uid));
      setMySharedTrips(all.filter(t => t.ownerId === user.uid));
    });
    return unsubscribe;
  }, []);

  const toggleMyTrip = async (trip) => {
    await updateDoc(doc(db, 'trips', trip.id), { isPublic: !trip.isPublic });
  };

  const copyTrip = async (trip) => {
    Alert.alert(
      '여행 복사',
      `"${trip.name}" 일정을 내 여행으로 복사할까요?`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '복사',
          onPress: async () => {
            const code = generateInviteCode();
            await addDoc(collection(db, 'trips'), {
              name: `${trip.name} (복사본)`,
              destination: trip.destination,
              ownerId: user.uid,
              members: [user.uid],
              memberRoles: { [user.uid]: 'owner' },
              inviteCode: code,
              isPublic: false,
              createdAt: serverTimestamp(),
            });
            Alert.alert('완료', '내 여행 목록에 추가되었습니다!');
          }
        }
      ]
    );
  };

  // FlatList 데이터 구성 (헤더 포함)
  const listData = [
    // ── 내가 공유 중인 여행 섹션 ──
    { type: 'myHeader' },
    ...(mySharedTrips.length > 0
      ? mySharedTrips.map(t => ({ type: 'myTrip', ...t }))
      : [{ type: 'myEmpty' }]
    ),
    // ── 다른 사람 여행 섹션 ──
    { type: 'otherHeader' },
    ...(publicTrips.length > 0
      ? publicTrips.map(t => ({ type: 'otherTrip', ...t }))
      : [{ type: 'otherEmpty' }]
    ),
  ];

  const renderItem = ({ item }) => {
    if (item.type === 'myHeader') {
      return (
        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitle}>📤 내가 공유 중인 여행</Text>
          <Text style={styles.sectionHint}>내 여행 탭 → 멤버에서 공개 설정 가능</Text>
        </View>
      );
    }
    if (item.type === 'myEmpty') {
      return (
        <View style={styles.myEmptyBox}>
          <Text style={styles.myEmptyText}>공유 중인 여행이 없어요</Text>
          <Text style={styles.myEmptyHint}>
            내 여행의 멤버 탭에서{'\n'}"커뮤니티 공개"를 켜보세요
          </Text>
        </View>
      );
    }
    if (item.type === 'myTrip') {
      return (
        <View style={styles.myTripCard}>
          <View style={styles.myTripLeft}>
            <Text style={styles.myTripFlag}>{item.flag || '🌍'}</Text>
            <View style={styles.myTripInfo}>
              <Text style={styles.myTripName}>{item.name}</Text>
              <Text style={styles.myTripDest}>📍 {item.destination}</Text>
              {item.startDate ? (
                <Text style={styles.myTripDate}>🗓 {item.startDate} ~ {item.endDate}</Text>
              ) : null}
              <Text style={styles.myTripSharing}>🌐 커뮤니티 공유 중</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.stopShareBtn}
            onPress={() => Alert.alert(
              '공유 중단',
              `"${item.name}" 여행의 커뮤니티 공개를 중단할까요?`,
              [
                { text: '취소', style: 'cancel' },
                { text: '중단', style: 'destructive', onPress: () => toggleMyTrip(item) },
              ]
            )}
          >
            <Text style={styles.stopShareText}>공유 중단</Text>
          </TouchableOpacity>
        </View>
      );
    }
    if (item.type === 'otherHeader') {
      return (
        <View style={[styles.sectionHeader, { marginTop: 8 }]}>
          <Text style={styles.sectionTitle}>🌍 다른 사람의 여행</Text>
          <Text style={styles.sectionHint}>마음에 드는 일정을 내 여행으로 복사해보세요</Text>
        </View>
      );
    }
    if (item.type === 'otherEmpty') {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>아직 공개된 여행이 없어요.</Text>
          <Text style={styles.emptyHint}>
            다른 사람이 공개 설정을 하면{'\n'}여기에 표시됩니다!
          </Text>
        </View>
      );
    }
    // otherTrip
    return (
      <View style={styles.tripCard}>
        <View style={styles.cardTop}>
          <Text style={styles.tripFlag}>{item.flag || '🌍'}</Text>
          <View style={styles.cardInfo}>
            <Text style={styles.tripName}>{item.name}</Text>
            <Text style={styles.tripDestination}>📍 {item.destination}</Text>
            {item.startDate ? (
              <Text style={styles.tripDate}>🗓 {item.startDate} ~ {item.endDate}</Text>
            ) : null}
            <Text style={styles.tripMembers}>👥 {item.members?.length || 1}명</Text>
          </View>
          <TouchableOpacity style={styles.copyBtn} onPress={() => copyTrip(item)}>
            <Text style={styles.copyBtnText}>복사</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>커뮤니티</Text>
        <Text style={styles.headerSubtitle}>여행 일정을 공유하고 참고해보세요</Text>
      </View>

      <FlatList
        data={listData}
        keyExtractor={(item, i) => item.id || `${item.type}-${i}`}
        contentContainerStyle={styles.list}
        renderItem={renderItem}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: { paddingHorizontal: 20, paddingBottom: 16 },
  headerTitle: { color: '#fff', fontSize: 26, fontWeight: 'bold', marginBottom: 4 },
  headerSubtitle: { color: '#aaa', fontSize: 14 },
  list: { paddingHorizontal: 20, paddingBottom: 40 },

  sectionHeader: { marginBottom: 10, marginTop: 4 },
  sectionTitle: { color: '#fff', fontSize: 15, fontWeight: 'bold', marginBottom: 2 },
  sectionHint: { color: '#555', fontSize: 11 },

  // 내 공유 여행 카드
  myTripCard: {
    backgroundColor: '#0f3460', borderRadius: 14, padding: 14,
    marginBottom: 10, flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(74,158,255,0.4)',
  },
  myTripLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  myTripFlag: { fontSize: 28, marginRight: 12 },
  myTripInfo: { flex: 1 },
  myTripName: { color: '#fff', fontSize: 15, fontWeight: 'bold', marginBottom: 2 },
  myTripDest: { color: '#aaa', fontSize: 12, marginBottom: 2 },
  myTripDate: { color: '#4a9eff', fontSize: 11, marginBottom: 3 },
  myTripSharing: { color: '#4aff91', fontSize: 11 },
  stopShareBtn: {
    backgroundColor: 'rgba(233,69,96,0.15)', borderRadius: 12,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: 'rgba(233,69,96,0.4)',
  },
  stopShareText: { color: '#e94560', fontSize: 12, fontWeight: 'bold' },

  myEmptyBox: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 16,
    alignItems: 'center', marginBottom: 10,
    borderWidth: 1, borderColor: '#0f3460', borderStyle: 'dashed',
  },
  myEmptyText: { color: '#555', fontSize: 14, marginBottom: 4 },
  myEmptyHint: { color: '#444', fontSize: 12, textAlign: 'center', lineHeight: 18 },

  // 다른 사람 여행 카드
  tripCard: {
    backgroundColor: '#16213e', borderRadius: 14, padding: 14,
    marginBottom: 10, borderWidth: 1, borderColor: '#0f3460',
  },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  tripFlag: { fontSize: 28, marginRight: 12 },
  cardInfo: { flex: 1 },
  tripName: { color: '#fff', fontSize: 15, fontWeight: 'bold', marginBottom: 3 },
  tripDestination: { color: '#aaa', fontSize: 13, marginBottom: 3 },
  tripDate: { color: '#4a9eff', fontSize: 11, marginBottom: 3 },
  tripMembers: { color: '#888', fontSize: 12 },
  copyBtn: {
    backgroundColor: '#e94560', paddingHorizontal: 14, paddingVertical: 8,
    borderRadius: 20, marginLeft: 10,
  },
  copyBtnText: { color: '#fff', fontSize: 13, fontWeight: 'bold' },

  emptyContainer: { alignItems: 'center', marginTop: 30 },
  emptyText: { color: '#aaa', fontSize: 15, marginBottom: 8 },
  emptyHint: { color: '#666', fontSize: 13, textAlign: 'center', lineHeight: 22 },
});
