import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, FlatList, TouchableOpacity,
  StyleSheet, Alert, Modal, TextInput, ScrollView,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection, addDoc, onSnapshot, query, where,
  serverTimestamp, getDocs, updateDoc, doc, arrayUnion,
  deleteDoc, arrayRemove, deleteField,
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { generateInviteCode } from '../utils/helpers';
import { detectFlag } from '../utils/countryFlag';
import ScrollPicker from '../components/ScrollPicker';

const YEARS  = Array.from({ length: 5 }, (_, i) => String(2024 + i));
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const DAYS   = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));

const DELETE_BTN_W = 80;

// ── 개별 카드 컴포넌트 ───────────────────────────────────────
function TripCard({ item, deleteMode, onPress, onDelete, userId }) {
  const isOwner = item.memberRoles?.[userId] === 'owner';

  return (
    <View style={[styles.cardWrapper, deleteMode && styles.cardWrapperEdit]}>
      {/* 카드 본체 — 편집 모드에서도 텍스트 그대로 */}
      <TouchableOpacity
        style={[styles.tripCard, deleteMode && styles.tripCardEdit]}
        onPress={deleteMode ? null : onPress}
        activeOpacity={deleteMode ? 1 : 0.75}
      >
        <Text style={styles.tripFlag}>{item.flag || '🌍'}</Text>
        <View style={styles.tripCardInfo}>
          <Text style={styles.tripName}>{item.name}</Text>
          <Text style={styles.tripDestination}>📍 {item.destination}</Text>
          {item.startDate && (
            <Text style={styles.tripDate}>
              🗓 {item.startDate} ~ {item.endDate}
              {'  '}{getDuration(item.startDate, item.endDate)}
            </Text>
          )}
          <Text style={styles.tripRole}>
            {isOwner ? '🚩 대표' : '👥 참여 중'}
          </Text>
        </View>
        {!deleteMode && <Text style={styles.arrow}>›</Text>}
      </TouchableOpacity>

      {/* 삭제/나가기 버튼 — 편집 모드에서만, 카드 오른쪽에 경계 없이 붙음 */}
      {deleteMode && (
        <TouchableOpacity
          style={[styles.deleteActionBtn, !isOwner && styles.leaveActionBtn]}
          onPress={() => onDelete(item)}
          activeOpacity={0.8}
        >
          <Text style={styles.deleteActionIcon}>{isOwner ? '🗑' : '🚪'}</Text>
          <Text style={styles.deleteActionText}>{isOwner ? '삭제' : '나가기'}</Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

function getDuration(start, end) {
  if (!start || !end) return '';
  const s = new Date(start), e = new Date(end);
  const days = Math.round((e - s) / (1000 * 60 * 60 * 24)) + 1;
  return `${days}일`;
}

// ── 메인 화면 ─────────────────────────────────────────────
export default function HomeScreen({ navigation }) {
  const insets = useSafeAreaInsets();
  const [trips, setTrips] = useState([]);
  const [deleteMode, setDeleteMode] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [tripName, setTripName] = useState('');
  const [destination, setDestination] = useState('');
  const [detectedFlag, setDetectedFlag] = useState('🌍');
  const [joinCode, setJoinCode] = useState('');
  const [joinModalVisible, setJoinModalVisible] = useState(false);
  const [placeSuggestions, setPlaceSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const searchTimerRef = useRef(null);

  const now = new Date();
  const [startYear,  setStartYear]  = useState(String(now.getFullYear()));
  const [startMonth, setStartMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [startDay,   setStartDay]   = useState(String(now.getDate()).padStart(2, '0'));
  const [endYear,    setEndYear]    = useState(String(now.getFullYear()));
  const [endMonth,   setEndMonth]   = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [endDay,     setEndDay]     = useState(String(now.getDate() + 3).padStart(2, '0'));

  const user = auth.currentUser;

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, 'trips'), where('members', 'array-contains', user.uid));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
      setTrips(data);
      // 여행이 없으면 편집 모드 자동 해제
      if (data.length === 0) setDeleteMode(false);
    });
    return unsubscribe;
  }, []);

  const extractCountry = (addr) => {
    if (!addr) return '';
    const parts = addr.split(',');
    return parts[parts.length - 1].trim();
  };

  const handleDestinationChange = (text) => {
    setDestination(text);
    const quickFlag = detectFlag(text);
    if (text.trim().length < 2) {
      // 입력이 짧으면 초기화
      setDetectedFlag('🌍');
      setPlaceSuggestions([]); setShowSuggestions(false);
      if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
      return;
    }
    if (quickFlag !== '🌍') {
      // 사전에 있는 도시면 즉시 적용
      setDetectedFlag(quickFlag);
    }
    // 사전에 없는 경우: 기존 국기 유지하면서 Places 검색 대기
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    searchTimerRef.current = setTimeout(() => searchPlaces(text), 400);
  };

  const searchPlaces = async (text) => {
    try {
      const fn = httpsCallable(getFunctions(undefined, 'asia-northeast3'), 'googlePlaceSearch');
      const res = await fn({ query: text, language: 'ko' });
      const raw = res.data?.results || [];

      // 국가 기준으로 중복 제거 — 같은 나라 결과는 하나만 표시
      const seen = new Set();
      const filtered = [];
      for (const place of raw) {
        const addr = place.formattedAddress || '';
        const flag = detectFlag(addr) !== '🌍' ? detectFlag(addr) : detectFlag(place.displayName?.text || '');
        const country = extractCountry(addr);
        const key = flag + country;
        if (!seen.has(key)) {
          seen.add(key);
          filtered.push({ ...place, _flag: flag, _country: country });
        }
        if (filtered.length >= 4) break;
      }
      setPlaceSuggestions(filtered);
      setShowSuggestions(filtered.length > 0);
      // 결과에서 국기 자동 적용 (사전에 없는 지명도 처리)
      if (filtered.length > 0 && filtered[0]._flag !== '🌍') {
        setDetectedFlag(filtered[0]._flag);
      }
    } catch {
      setPlaceSuggestions([]); setShowSuggestions(false);
    }
  };

  const handleSelectPlace = (place) => {
    setDetectedFlag(place._flag || '🌍');
    setShowSuggestions(false);
    setPlaceSuggestions([]);
  };

  const clearSuggestions = () => { setShowSuggestions(false); setPlaceSuggestions([]); };

  const createTrip = async () => {
    if (!tripName.trim() || !destination.trim()) {
      Alert.alert('알림', '여행 이름과 목적지를 입력해주세요.');
      return;
    }
    const startDate = `${startYear}-${startMonth}-${startDay}`;
    const endDate   = `${endYear}-${endMonth}-${endDay}`;
    if (startDate > endDate) {
      Alert.alert('알림', '종료일이 시작일보다 빠를 수 없어요.');
      return;
    }
    const code = generateInviteCode();
    await addDoc(collection(db, 'trips'), {
      name: tripName.trim(),
      destination: destination.trim(),
      flag: detectedFlag,
      startDate, endDate,
      ownerId: user.uid,
      members: [user.uid],
      memberRoles: { [user.uid]: 'owner' },
      inviteCode: code,
      isPublic: false,
      createdAt: serverTimestamp(),
    });
    setTripName(''); setDestination(''); setDetectedFlag('🌍');
    clearSuggestions();
    setModalVisible(false);
  };

  const joinTrip = async () => {
    if (!joinCode.trim()) return;
    const snapshot = await getDocs(
      query(collection(db, 'trips'), where('inviteCode', '==', joinCode.trim().toUpperCase()))
    );
    if (snapshot.empty) { Alert.alert('오류', '유효하지 않은 초대 코드입니다.'); return; }
    const tripDoc = snapshot.docs[0];
    if (tripDoc.data().members.includes(user.uid)) {
      Alert.alert('알림', '이미 참여 중인 여행입니다.'); return;
    }
    await updateDoc(doc(db, 'trips', tripDoc.id), {
      members: arrayUnion(user.uid),
      [`memberRoles.${user.uid}`]: 'viewer',
    });
    setJoinCode(''); setJoinModalVisible(false);
    Alert.alert('성공', '여행에 참여했습니다!');
  };

  // 삭제 / 나가기
  const handleDelete = (item) => {
    const isOwner = item.memberRoles?.[user.uid] === 'owner';

    if (isOwner) {
      Alert.alert(
        '여행 삭제',
        `"${item.name}" 여행을 삭제할까요?\n삭제 시 모든 일정과 비용 데이터가 함께 삭제됩니다.`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '삭제',
            style: 'destructive',
            onPress: async () => {
              await deleteDoc(doc(db, 'trips', item.id));
            },
          },
        ]
      );
    } else {
      Alert.alert(
        '여행 나가기',
        `"${item.name}" 여행에서 나갈까요?`,
        [
          { text: '취소', style: 'cancel' },
          {
            text: '나가기',
            style: 'destructive',
            onPress: async () => {
              await updateDoc(doc(db, 'trips', item.id), {
                members: arrayRemove(user.uid),
                [`memberRoles.${user.uid}`]: deleteField(),
              });
            },
          },
        ]
      );
    }
  };

  return (
    <View style={styles.container}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>내 여행</Text>
        {trips.length > 0 && (
          <TouchableOpacity
            style={[styles.deleteModeBtn, deleteMode && styles.deleteModeBtnActive]}
            onPress={() => setDeleteMode(prev => !prev)}
          >
            <Text style={[styles.deleteModeBtnText, deleteMode && styles.deleteModeBtnTextActive]}>
              {deleteMode ? '완료' : '편집'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {deleteMode && (
        <View style={styles.deleteModeBar}>
          <Text style={styles.deleteModeBarText}>
            🗑 삭제할 여행을 선택하세요 · 🚩 대표는 삭제, 👥 참여자는 나가기
          </Text>
        </View>
      )}

      <FlatList
        data={trips}
        keyExtractor={item => item.id}
        contentContainerStyle={styles.list}
        ListEmptyComponent={
          <Text style={styles.emptyText}>아직 여행이 없어요.{'\n'}새 여행을 만들어보세요! ✈️</Text>
        }
        renderItem={({ item }) => (
          <TripCard
            item={item}
            deleteMode={deleteMode}
            userId={user.uid}
            onPress={() => navigation.navigate('TripDetail', { trip: item })}
            onDelete={handleDelete}
          />
        )}
      />

      {/* FAB */}
      {!deleteMode && (
        <View style={styles.fabContainer}>
          <TouchableOpacity style={styles.fabSecondary} onPress={() => setJoinModalVisible(true)}>
            <Text style={styles.fabText}>코드로 참여</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.fab} onPress={() => setModalVisible(true)}>
            <Text style={styles.fabText}>+ 새 여행</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* 새 여행 만들기 모달 */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <View style={styles.modalOverlay}>
          <ScrollView keyboardShouldPersistTaps="handled">
            <View style={[styles.modal, { paddingBottom: insets.bottom + 24 }]}>
              <Text style={styles.modalTitle}>새 여행 만들기</Text>

              <TextInput
                style={styles.modalInput}
                placeholder="여행 이름 (예: 도쿄 봄 여행)"
                placeholderTextColor="#aaa"
                value={tripName}
                onChangeText={setTripName}
              />

              <View style={styles.destinationRow}>
                <TextInput
                  style={[styles.modalInput, { flex: 1, marginBottom: 0 }]}
                  placeholder="목적지 (예: 시즈오카, 파리, 발리)"
                  placeholderTextColor="#aaa"
                  value={destination}
                  onChangeText={handleDestinationChange}
                />
                <View style={styles.flagBox}>
                  <Text style={styles.flagText}>{detectedFlag}</Text>
                </View>
              </View>

              {/* 장소 검색 드롭다운 */}
              {showSuggestions && placeSuggestions.length > 0 && (
                <View style={styles.suggestionsBox}>
                  {placeSuggestions.map((place, idx) => (
                    <TouchableOpacity
                      key={idx}
                      style={[styles.suggestionItem, idx === placeSuggestions.length - 1 && { borderBottomWidth: 0 }]}
                      onPress={() => handleSelectPlace(place)}
                    >
                      <Text style={styles.suggestionFlag}>{place._flag || '🌍'}</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.suggestionName}>{place._country || place.displayName?.text}</Text>
                      </View>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              <Text style={styles.flagHint}>지명만 입력해도 나라를 자동으로 찾아드려요</Text>

              <Text style={styles.dateLabel}>시작일</Text>
              <View style={styles.pickerRow}>
                <ScrollPicker items={YEARS}  selectedValue={startYear}  onValueChange={setStartYear}  width={72} />
                <Text style={styles.pickerSep}>년</Text>
                <ScrollPicker items={MONTHS} selectedValue={startMonth} onValueChange={setStartMonth} width={52} />
                <Text style={styles.pickerSep}>월</Text>
                <ScrollPicker items={DAYS}   selectedValue={startDay}   onValueChange={setStartDay}   width={52} />
                <Text style={styles.pickerSep}>일</Text>
              </View>

              <Text style={styles.dateLabel}>종료일</Text>
              <View style={styles.pickerRow}>
                <ScrollPicker items={YEARS}  selectedValue={endYear}  onValueChange={setEndYear}  width={72} />
                <Text style={styles.pickerSep}>년</Text>
                <ScrollPicker items={MONTHS} selectedValue={endMonth} onValueChange={setEndMonth} width={52} />
                <Text style={styles.pickerSep}>월</Text>
                <ScrollPicker items={DAYS}   selectedValue={endDay}   onValueChange={setEndDay}   width={52} />
                <Text style={styles.pickerSep}>일</Text>
              </View>

              <View style={styles.modalButtons}>
                <TouchableOpacity style={styles.cancelBtn} onPress={() => { setModalVisible(false); clearSuggestions(); }}>
                  <Text style={styles.cancelBtnText}>취소</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.confirmBtn} onPress={createTrip}>
                  <Text style={styles.confirmBtnText}>만들기</Text>
                </TouchableOpacity>
              </View>
            </View>
          </ScrollView>
        </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 코드로 참여 모달 */}
      <Modal visible={joinModalVisible} transparent animationType="slide">
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 24 }]}>
            <Text style={styles.modalTitle}>초대 코드로 참여</Text>
            <TextInput
              style={styles.modalInput}
              placeholder="초대 코드 입력"
              placeholderTextColor="#aaa"
              value={joinCode}
              onChangeText={setJoinCode}
              autoCapitalize="characters"
            />
            <View style={styles.modalButtons}>
              <TouchableOpacity style={styles.cancelBtn} onPress={() => setJoinModalVisible(false)}>
                <Text style={styles.cancelBtnText}>취소</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.confirmBtn} onPress={joinTrip}>
                <Text style={styles.confirmBtnText}>참여</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingHorizontal: 20, paddingBottom: 16,
  },
  headerTitle: { color: '#fff', fontSize: 26, fontWeight: 'bold' },

  deleteModeBtn: {
    paddingHorizontal: 16, paddingVertical: 7,
    borderRadius: 20, borderWidth: 1, borderColor: '#0f3460',
    backgroundColor: '#16213e',
  },
  deleteModeBtnActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  deleteModeBtnText: { color: '#aaa', fontSize: 14, fontWeight: 'bold' },
  deleteModeBtnTextActive: { color: '#fff' },

  deleteModeBar: {
    backgroundColor: 'rgba(233,69,96,0.1)', paddingHorizontal: 20, paddingVertical: 8,
    borderBottomWidth: 1, borderBottomColor: 'rgba(233,69,96,0.2)',
  },
  deleteModeBarText: { color: '#e94560', fontSize: 11, textAlign: 'center' },

  list: { padding: 20, paddingBottom: 100 },

  // 카드 래퍼 — 항상 row, overflow:hidden으로 둥근 모서리 처리
  cardWrapper: {
    marginBottom: 14,
    borderRadius: 14,
    overflow: 'hidden',
    flexDirection: 'row',
  },
  // 편집 모드: 래퍼에 테두리, 카드 개별 테두리 제거
  cardWrapperEdit: {
    borderWidth: 1,
    borderColor: '#0f3460',
  },

  // 삭제/나가기 버튼 — 카드 오른쪽에 경계 없이 붙음
  deleteActionBtn: {
    width: DELETE_BTN_W,
    backgroundColor: '#e94560',
    justifyContent: 'center', alignItems: 'center',
  },
  leaveActionBtn: { backgroundColor: '#ff8c00' },
  deleteActionIcon: { fontSize: 20, marginBottom: 2 },
  deleteActionText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },

  // 트립 카드
  tripCard: {
    flex: 1,
    backgroundColor: '#16213e', borderRadius: 14, padding: 16,
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderColor: '#0f3460',
  },
  // 편집 모드: 카드 개별 테두리·radius 제거 (래퍼가 담당)
  tripCardEdit: {
    borderWidth: 0,
    borderRadius: 0,
  },
  tripFlag: { fontSize: 36, marginRight: 14 },
  tripCardInfo: { flex: 1 },
  tripName: { color: '#fff', fontSize: 17, fontWeight: 'bold', marginBottom: 3 },
  tripDestination: { color: '#aaa', fontSize: 13, marginBottom: 3 },
  tripDate: { color: '#4a9eff', fontSize: 12, marginBottom: 3 },
  tripRole: { color: '#e94560', fontSize: 12 },
  arrow: { color: '#aaa', fontSize: 24 },

  emptyText: { color: '#aaa', textAlign: 'center', marginTop: 80, fontSize: 16, lineHeight: 26 },

  fabContainer: { position: 'absolute', bottom: 30, right: 20, flexDirection: 'row', gap: 10 },
  fab: { backgroundColor: '#e94560', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 30, elevation: 5 },
  fabSecondary: { backgroundColor: '#0f3460', paddingHorizontal: 20, paddingVertical: 14, borderRadius: 30, elevation: 5 },
  fabText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal: { backgroundColor: '#16213e', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle: { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 18 },
  modalInput: {
    backgroundColor: '#1a1a2e', color: '#fff', padding: 14,
    borderRadius: 10, marginBottom: 12, fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  destinationRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 6 },
  flagBox: {
    width: 52, height: 52, backgroundColor: '#1a1a2e', borderRadius: 10,
    borderWidth: 1, borderColor: '#0f3460', justifyContent: 'center', alignItems: 'center',
  },
  flagText: { fontSize: 28 },
  flagHint: { color: '#666', fontSize: 11, marginBottom: 16 },

  suggestionsBox: {
    backgroundColor: '#0f1b35', borderRadius: 10, marginBottom: 8,
    borderWidth: 1, borderColor: '#0f3460', overflow: 'hidden',
  },
  suggestionItem: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14,
    paddingVertical: 11, gap: 12,
    borderBottomWidth: 1, borderBottomColor: 'rgba(15,52,96,0.6)',
  },
  suggestionFlag: { fontSize: 24 },
  suggestionName: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginBottom: 2 },
  suggestionAddr: { color: '#666', fontSize: 11 },
  dateLabel: { color: '#aaa', fontSize: 13, marginBottom: 8 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a2e', borderRadius: 12, padding: 8, marginBottom: 14,
  },
  pickerSep: { color: '#aaa', fontSize: 14, marginHorizontal: 4 },
  modalButtons: { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn: { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#0f3460', alignItems: 'center' },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
  confirmBtn: { flex: 1, backgroundColor: '#e94560', padding: 14, borderRadius: 10, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },
});
