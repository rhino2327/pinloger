import React, { useState, useEffect } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet,
  Modal, Alert, ActivityIndicator, TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection, query, where, onSnapshot, doc, updateDoc,
  arrayUnion, arrayRemove, addDoc, getDocs, serverTimestamp,
} from 'firebase/firestore';
import { db, auth } from '../config/firebase';
import { generateInviteCode } from '../utils/helpers';
import { TRANSPORTS } from '../utils/transport';
import ScrollPicker from '../components/ScrollPicker';

const YEARS  = Array.from({ length: 5 }, (_, i) => String(2024 + i));
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
const DAYS   = Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0'));

function getTripDays(startDate, endDate) {
  if (!startDate || !endDate) return [];
  const days = [];
  const cur = new Date(startDate);
  const end = new Date(endDate);
  let dayNum = 1;
  while (cur <= end) {
    const y = cur.getFullYear();
    const m = String(cur.getMonth() + 1).padStart(2, '0');
    const d = String(cur.getDate()).padStart(2, '0');
    days.push({ date: `${y}-${m}-${d}`, label: `DAY ${dayNum}` });
    cur.setDate(cur.getDate() + 1);
    dayNum++;
  }
  return days;
}

function getDuration(startTime, endTime) {
  if (!startTime || !endTime) return null;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  const total = (eh * 60 + em) - (sh * 60 + sm);
  if (total <= 0) return null;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

export default function CommunityTripDetailScreen({ route }) {
  const { trip } = route.params;
  const insets = useSafeAreaInsets();
  const user = auth.currentUser;

  const [schedules, setSchedules] = useState([]);
  const [activeDay, setActiveDay] = useState(null);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [likeLoading, setLikeLoading] = useState(false);

  // Copy modal state
  const [copyVisible, setCopyVisible] = useState(false);
  const [copyStep, setCopyStep] = useState(1);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [copyMode, setCopyMode] = useState(null); // 'new' | 'existing'
  const [myTrips, setMyTrips] = useState([]);
  const [newTripName, setNewTripName] = useState('');
  const [newTripDest, setNewTripDest] = useState('');
  const [copying, setCopying] = useState(false);

  const now = new Date();
  const [newStartYear,  setNewStartYear]  = useState(String(now.getFullYear()));
  const [newStartMonth, setNewStartMonth] = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [newStartDay,   setNewStartDay]   = useState(String(now.getDate()).padStart(2, '0'));
  const [newEndYear,    setNewEndYear]    = useState(String(now.getFullYear()));
  const [newEndMonth,   setNewEndMonth]   = useState(String(now.getMonth() + 1).padStart(2, '0'));
  const [newEndDay,     setNewEndDay]     = useState(String(now.getDate()).padStart(2, '0'));

  const tripDays = getTripDays(trip.startDate, trip.endDate);

  useEffect(() => {
    const q = query(collection(db, 'schedules'), where('tripId', '==', trip.id));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (a.time || '') > (b.time || '') ? 1 : -1);
      setSchedules(data);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(doc(db, 'trips', trip.id), (snap) => {
      if (!snap.exists()) return;
      const likedBy = snap.data().likedBy || [];
      setLiked(likedBy.includes(user.uid));
      setLikeCount(likedBy.length);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    if (tripDays.length > 0 && !activeDay) {
      setActiveDay(tripDays[0].date);
    }
  }, [schedules]);

  const handleLike = async () => {
    if (likeLoading) return;
    setLikeLoading(true);
    try {
      const ref = doc(db, 'trips', trip.id);
      if (liked) {
        await updateDoc(ref, { likedBy: arrayRemove(user.uid) });
      } else {
        await updateDoc(ref, { likedBy: arrayUnion(user.uid) });
      }
    } catch {
      Alert.alert('오류', '좋아요 처리 중 오류가 발생했어요.');
    } finally {
      setLikeLoading(false);
    }
  };

  const openCopyModal = async () => {
    setSelectedIds(new Set());
    setCopyStep(1);
    setCopyMode(null);
    setNewTripName(trip.name);
    setNewTripDest(trip.destination || '');

    // 커뮤니티 여행의 날짜로 기본값 초기화
    const parsePart = (dateStr, part) => {
      if (!dateStr || dateStr.length < 10) return null;
      if (part === 'y') return dateStr.slice(0, 4);
      if (part === 'm') return dateStr.slice(5, 7);
      return dateStr.slice(8, 10);
    };
    const sd = trip.startDate, ed = trip.endDate;
    setNewStartYear(parsePart(sd, 'y') || String(now.getFullYear()));
    setNewStartMonth(parsePart(sd, 'm') || String(now.getMonth() + 1).padStart(2, '0'));
    setNewStartDay(parsePart(sd, 'd') || String(now.getDate()).padStart(2, '0'));
    setNewEndYear(parsePart(ed, 'y') || String(now.getFullYear()));
    setNewEndMonth(parsePart(ed, 'm') || String(now.getMonth() + 1).padStart(2, '0'));
    setNewEndDay(parsePart(ed, 'd') || String(now.getDate()).padStart(2, '0'));
    try {
      const q = query(collection(db, 'trips'), where('members', 'array-contains', user.uid));
      const snap = await getDocs(q);
      setMyTrips(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch {}
    setCopyVisible(true);
  };

  const toggleSchedule = (id) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCopyToNew = async () => {
    if (!newTripName.trim()) { Alert.alert('알림', '여행 이름을 입력해주세요.'); return; }
    const startDate = `${newStartYear}-${newStartMonth}-${newStartDay}`;
    const endDate   = `${newEndYear}-${newEndMonth}-${newEndDay}`;
    if (startDate > endDate) { Alert.alert('알림', '종료일이 시작일보다 빠를 수 없어요.'); return; }
    setCopying(true);
    try {
      const newTripRef = await addDoc(collection(db, 'trips'), {
        name: newTripName.trim(),
        destination: newTripDest.trim(),
        flag: trip.flag || '🌍',
        startDate,
        endDate,
        ownerId: user.uid,
        members: [user.uid],
        memberRoles: { [user.uid]: 'owner' },
        inviteCode: generateInviteCode(),
        isPublic: false,
        createdAt: serverTimestamp(),
      });
      const toCopy = schedules.filter(s => selectedIds.has(s.id));
      await Promise.all(toCopy.map(s => {
        const { id, ...rest } = s;
        return addDoc(collection(db, 'schedules'), {
          ...rest, tripId: newTripRef.id, createdAt: serverTimestamp(),
        });
      }));
      setCopyVisible(false);
      Alert.alert('완료', `"${newTripName}" 여행에 ${toCopy.length}개 일정이 복사되었어요!`);
    } catch {
      Alert.alert('오류', '복사 중 오류가 발생했어요.');
    } finally {
      setCopying(false);
    }
  };

  const handleCopyToExisting = async (targetTrip) => {
    setCopying(true);
    try {
      const toCopy = schedules.filter(s => selectedIds.has(s.id));
      await Promise.all(toCopy.map(s => {
        const { id, ...rest } = s;
        return addDoc(collection(db, 'schedules'), {
          ...rest, tripId: targetTrip.id, createdAt: serverTimestamp(),
        });
      }));
      setCopyVisible(false);
      Alert.alert('완료', `"${targetTrip.name}" 여행에 ${toCopy.length}개 일정이 추가되었어요!`);
    } catch {
      Alert.alert('오류', '복사 중 오류가 발생했어요.');
    } finally {
      setCopying(false);
    }
  };

  const daySchedules = activeDay
    ? schedules.filter(s => s.date === activeDay)
    : schedules;

  return (
    <View style={styles.container}>

      {/* 여행 요약 헤더 */}
      <View style={styles.tripHeader}>
        <Text style={styles.tripFlag}>{trip.flag || '🌍'}</Text>
        <View style={styles.tripHeaderInfo}>
          <Text style={styles.tripName}>{trip.name}</Text>
          <Text style={styles.tripDest}>📍 {trip.destination}</Text>
          {trip.startDate && (
            <Text style={styles.tripDate}>🗓 {trip.startDate} ~ {trip.endDate}</Text>
          )}
          <Text style={styles.tripMeta}>👥 {trip.members?.length || 1}명 · ❤️ {likeCount}</Text>
        </View>
      </View>

      {/* DAY 탭 */}
      {tripDays.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}
          style={styles.dayTabsContainer} contentContainerStyle={styles.dayTabsContent}>
          {tripDays.map((day) => {
            const count = schedules.filter(s => s.date === day.date).length;
            const isActive = activeDay === day.date;
            return (
              <TouchableOpacity key={day.date}
                style={[styles.dayTab, isActive && styles.dayTabActive]}
                onPress={() => setActiveDay(day.date)}>
                <Text style={[styles.dayTabLabel, isActive && styles.dayTabLabelActive]}>{day.label}</Text>
                <Text style={[styles.dayTabDate, isActive && styles.dayTabDateActive]}>{day.date.slice(5)}</Text>
                {count > 0 && (
                  <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>
                )}
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      )}

      {/* 일정 목록 */}
      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: 110 + insets.bottom }]}>
        {daySchedules.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>이 날 일정이 없어요</Text>
          </View>
        ) : (
          daySchedules.map((item, index) => (
            <View key={item.id} style={styles.scheduleRow}>
              <View style={styles.timeline}>
                <View style={styles.dot} />
                {index < daySchedules.length - 1 && <View style={styles.line} />}
              </View>
              <View style={styles.scheduleCard}>
                <View style={styles.cardHeader}>
                  <Text style={styles.scheduleTime}>
                    {item.time
                      ? (item.endTime ? `${item.time} ~ ${item.endTime}` : item.time)
                      : '시간 미정'}
                  </Text>
                  {item.time && item.endTime && getDuration(item.time, item.endTime) && (
                    <View style={styles.durationBadge}>
                      <Text style={styles.durationText}>⏱ {getDuration(item.time, item.endTime)}</Text>
                    </View>
                  )}
                </View>
                {item.transport && (
                  <View style={styles.transportBadge}>
                    <Text style={styles.transportText}>
                      {TRANSPORTS.find(t => t.emoji === item.transport)?.emoji}{' '}
                      {TRANSPORTS.find(t => t.emoji === item.transport)?.label}
                      {item.flightNumber ? `  ${item.flightNumber}` : ''}
                    </Text>
                  </View>
                )}
                <Text style={styles.scheduleTitle}>{item.title}</Text>
                {(item.fromLocation || item.toLocation || item.location) && (
                  <View style={styles.locationInfo}>
                    {item.fromLocation ? (
                      <Text style={styles.locFrom}>🚀 {item.fromLocation}</Text>
                    ) : null}
                    {(item.toLocation || item.location) ? (
                      <Text style={styles.locTo}>📍 {item.toLocation || item.location}</Text>
                    ) : null}
                  </View>
                )}
                {item.memo ? <Text style={styles.memoText}>📝 {item.memo}</Text> : null}
                {item.cost > 0 && (
                  <View style={styles.costRow}>
                    <Text style={styles.costText}>💰 {item.cost.toLocaleString()} {item.currency}</Text>
                  </View>
                )}
              </View>
            </View>
          ))
        )}
      </ScrollView>

      {/* 하단 액션 바 */}
      <View style={[styles.actionBar, { paddingBottom: insets.bottom + 12 }]}>
        <TouchableOpacity
          style={[styles.likeBtn, liked && styles.likeBtnActive]}
          onPress={handleLike}
          disabled={likeLoading}
        >
          {likeLoading
            ? <ActivityIndicator size="small" color={liked ? '#fff' : '#e94560'} />
            : <Text style={[styles.likeBtnText, liked && styles.likeBtnTextActive]}>
                {liked ? '❤️' : '🤍'} {likeCount}
              </Text>
          }
        </TouchableOpacity>
        <TouchableOpacity style={styles.copyBtn} onPress={openCopyModal}>
          <Text style={styles.copyBtnText}>📋 일정 복사</Text>
        </TouchableOpacity>
      </View>

      {/* 복사 모달 */}
      <Modal visible={copyVisible} transparent animationType="slide">
        <View style={styles.modalOverlay}>
          <View style={[styles.modal, { paddingBottom: insets.bottom + 16 }]}>

            {copyStep === 1 ? (
              <>
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>복사할 일정 선택</Text>
                  <TouchableOpacity onPress={() => setCopyVisible(false)}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.selectAllRow}>
                  <Text style={styles.selectCountText}>{selectedIds.size}개 선택됨</Text>
                  <TouchableOpacity onPress={() => {
                    if (selectedIds.size === schedules.length) {
                      setSelectedIds(new Set());
                    } else {
                      setSelectedIds(new Set(schedules.map(s => s.id)));
                    }
                  }}>
                    <Text style={styles.selectAllText}>
                      {selectedIds.size === schedules.length ? '전체 해제' : '전체 선택'}
                    </Text>
                  </TouchableOpacity>
                </View>

                <ScrollView style={styles.scheduleList} showsVerticalScrollIndicator={false}>
                  {tripDays.length > 0
                    ? tripDays.map(day => {
                        const dayItems = schedules.filter(s => s.date === day.date);
                        if (dayItems.length === 0) return null;
                        return (
                          <View key={day.date}>
                            <Text style={styles.copyDayHeader}>{day.label} · {day.date.slice(5)}</Text>
                            {dayItems.map(s => (
                              <TouchableOpacity
                                key={s.id}
                                style={[styles.copyItem, selectedIds.has(s.id) && styles.copyItemSelected]}
                                onPress={() => toggleSchedule(s.id)}
                              >
                                <View style={[styles.checkbox, selectedIds.has(s.id) && styles.checkboxOn]}>
                                  {selectedIds.has(s.id) && <Text style={styles.checkmark}>✓</Text>}
                                </View>
                                <View style={styles.copyItemInfo}>
                                  <Text style={styles.copyItemTitle}>{s.title}</Text>
                                  {s.time ? <Text style={styles.copyItemTime}>{s.time}{s.endTime ? ` ~ ${s.endTime}` : ''}</Text> : null}
                                  {(s.toLocation || s.location) ? (
                                    <Text style={styles.copyItemLoc} numberOfLines={1}>
                                      📍 {s.toLocation || s.location}
                                    </Text>
                                  ) : null}
                                </View>
                              </TouchableOpacity>
                            ))}
                          </View>
                        );
                      })
                    : schedules.map(s => (
                        <TouchableOpacity
                          key={s.id}
                          style={[styles.copyItem, selectedIds.has(s.id) && styles.copyItemSelected]}
                          onPress={() => toggleSchedule(s.id)}
                        >
                          <View style={[styles.checkbox, selectedIds.has(s.id) && styles.checkboxOn]}>
                            {selectedIds.has(s.id) && <Text style={styles.checkmark}>✓</Text>}
                          </View>
                          <View style={styles.copyItemInfo}>
                            <Text style={styles.copyItemTitle}>{s.title}</Text>
                            {s.time ? <Text style={styles.copyItemTime}>{s.time}</Text> : null}
                          </View>
                        </TouchableOpacity>
                      ))
                  }
                </ScrollView>

                <TouchableOpacity
                  style={[styles.nextBtn, selectedIds.size === 0 && styles.nextBtnDisabled]}
                  onPress={() => selectedIds.size > 0 && setCopyStep(2)}
                >
                  <Text style={styles.nextBtnText}>다음 ({selectedIds.size}개 선택)</Text>
                </TouchableOpacity>
              </>
            ) : (
              <>
                <View style={styles.modalHeader}>
                  <TouchableOpacity onPress={() => setCopyStep(1)}>
                    <Text style={styles.backBtn}>← 뒤로</Text>
                  </TouchableOpacity>
                  <Text style={styles.modalTitle}>복사 위치 선택</Text>
                  <TouchableOpacity onPress={() => setCopyVisible(false)}>
                    <Text style={styles.modalClose}>✕</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.modeTabs}>
                  <TouchableOpacity
                    style={[styles.modeTab, copyMode === 'new' && styles.modeTabActive]}
                    onPress={() => setCopyMode('new')}
                  >
                    <Text style={[styles.modeTabText, copyMode === 'new' && styles.modeTabTextActive]}>
                      ✨ 새 여행으로
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modeTab, copyMode === 'existing' && styles.modeTabActive]}
                    onPress={() => setCopyMode('existing')}
                  >
                    <Text style={[styles.modeTabText, copyMode === 'existing' && styles.modeTabTextActive]}>
                      📁 기존 여행에 추가
                    </Text>
                  </TouchableOpacity>
                </View>

                {copyMode === 'new' && (
                  <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
                    <TextInput
                      style={styles.formInput}
                      placeholder="여행 이름"
                      placeholderTextColor="#555"
                      value={newTripName}
                      onChangeText={setNewTripName}
                    />
                    <TextInput
                      style={styles.formInput}
                      placeholder="목적지"
                      placeholderTextColor="#555"
                      value={newTripDest}
                      onChangeText={setNewTripDest}
                    />
                    <Text style={styles.dateLabel}>시작일</Text>
                    <View style={styles.pickerRow}>
                      <ScrollPicker items={YEARS}  selectedValue={newStartYear}  onValueChange={setNewStartYear}  width={72} />
                      <Text style={styles.pickerSep}>년</Text>
                      <ScrollPicker items={MONTHS} selectedValue={newStartMonth} onValueChange={setNewStartMonth} width={52} />
                      <Text style={styles.pickerSep}>월</Text>
                      <ScrollPicker items={DAYS}   selectedValue={newStartDay}   onValueChange={setNewStartDay}   width={52} />
                      <Text style={styles.pickerSep}>일</Text>
                    </View>
                    <Text style={styles.dateLabel}>종료일</Text>
                    <View style={styles.pickerRow}>
                      <ScrollPicker items={YEARS}  selectedValue={newEndYear}  onValueChange={setNewEndYear}  width={72} />
                      <Text style={styles.pickerSep}>년</Text>
                      <ScrollPicker items={MONTHS} selectedValue={newEndMonth} onValueChange={setNewEndMonth} width={52} />
                      <Text style={styles.pickerSep}>월</Text>
                      <ScrollPicker items={DAYS}   selectedValue={newEndDay}   onValueChange={setNewEndDay}   width={52} />
                      <Text style={styles.pickerSep}>일</Text>
                    </View>
                    <TouchableOpacity
                      style={[styles.confirmBtn, copying && styles.confirmBtnDisabled]}
                      onPress={handleCopyToNew}
                      disabled={copying}
                    >
                      {copying
                        ? <ActivityIndicator color="#fff" />
                        : <Text style={styles.confirmBtnText}>새 여행으로 복사</Text>
                      }
                    </TouchableOpacity>
                  </ScrollView>
                )}

                {copyMode === 'existing' && (
                  <ScrollView style={styles.myTripList} showsVerticalScrollIndicator={false}>
                    {myTrips.length === 0 ? (
                      <Text style={styles.noTripsText}>추가할 수 있는 여행이 없어요</Text>
                    ) : (
                      myTrips.map(t => {
                        const compatible = !trip.flag || trip.flag === '🌍' || !t.flag || t.flag === '🌍' || t.flag === trip.flag;
                        return (
                          <TouchableOpacity
                            key={t.id}
                            style={[styles.myTripItem, !compatible && styles.myTripItemDisabled]}
                            onPress={() => !copying && compatible && handleCopyToExisting(t)}
                            disabled={copying || !compatible}
                            activeOpacity={compatible ? 0.75 : 1}
                          >
                            <Text style={styles.myTripFlag}>{t.flag || '🌍'}</Text>
                            <View style={styles.myTripInfo}>
                              <Text style={[styles.myTripName, !compatible && styles.myTripTextDisabled]}>{t.name}</Text>
                              <Text style={[styles.myTripDest, !compatible && styles.myTripTextDisabled]}>📍 {t.destination}</Text>
                              {!compatible && (
                                <Text style={styles.myTripMismatch}>나라가 달라 추가할 수 없어요</Text>
                              )}
                            </View>
                            {compatible && (
                              copying
                                ? <ActivityIndicator size="small" color="#e94560" />
                                : <Text style={styles.myTripArrow}>›</Text>
                            )}
                          </TouchableOpacity>
                        );
                      })
                    )}
                  </ScrollView>
                )}
              </>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },

  tripHeader: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingVertical: 16,
    backgroundColor: '#16213e', borderBottomWidth: 1, borderBottomColor: '#0f3460',
  },
  tripFlag: { fontSize: 36, marginRight: 14 },
  tripHeaderInfo: { flex: 1 },
  tripName: { color: '#fff', fontSize: 17, fontWeight: 'bold', marginBottom: 3 },
  tripDest: { color: '#aaa', fontSize: 13, marginBottom: 2 },
  tripDate: { color: '#4a9eff', fontSize: 12, marginBottom: 2 },
  tripMeta: { color: '#888', fontSize: 12 },

  dayTabsContainer: { maxHeight: 80, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  dayTabsContent: { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  dayTab: {
    alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 12, backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460',
    minWidth: 64, position: 'relative',
  },
  dayTabActive: { backgroundColor: '#e94560', borderColor: '#e94560' },
  dayTabLabel: { color: '#aaa', fontSize: 11, fontWeight: 'bold' },
  dayTabLabelActive: { color: '#fff' },
  dayTabDate: { color: '#666', fontSize: 12, marginTop: 2 },
  dayTabDateActive: { color: 'rgba(255,255,255,0.8)' },
  badge: {
    position: 'absolute', top: -6, right: -6, backgroundColor: '#4a9eff',
    borderRadius: 10, minWidth: 18, height: 18,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },

  scroll: { padding: 20 },
  emptyBox: { alignItems: 'center', marginTop: 60 },
  emptyText: { color: '#aaa', fontSize: 15 },

  scheduleRow: { flexDirection: 'row', marginBottom: 4 },
  timeline: { width: 24, alignItems: 'center', paddingTop: 18 },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#e94560' },
  line: { width: 2, flex: 1, backgroundColor: '#0f3460', marginTop: 4 },
  scheduleCard: {
    flex: 1, backgroundColor: '#16213e', borderRadius: 12, padding: 14,
    marginLeft: 10, marginBottom: 10, borderWidth: 1, borderColor: '#0f3460',
  },
  cardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 6 },
  scheduleTime: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  durationBadge: {
    backgroundColor: 'rgba(74,158,255,0.15)', borderRadius: 8,
    paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(74,158,255,0.25)',
  },
  durationText: { color: '#4a9eff', fontSize: 11, fontWeight: 'bold' },
  transportBadge: {
    backgroundColor: 'rgba(74,158,255,0.15)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: 'flex-start', marginBottom: 6,
    borderWidth: 1, borderColor: 'rgba(74,158,255,0.3)',
  },
  transportText: { color: '#4a9eff', fontSize: 12 },
  scheduleTitle: { color: '#fff', fontSize: 15, fontWeight: 'bold', marginBottom: 4 },
  locationInfo: { marginTop: 2, marginBottom: 2 },
  locFrom: { color: '#4aff91', fontSize: 13, marginBottom: 2 },
  locTo: { color: '#aaa', fontSize: 13 },
  memoText: { color: '#888', fontSize: 13, marginTop: 4 },
  costRow: {
    marginTop: 6, backgroundColor: 'rgba(233,69,96,0.1)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: 'rgba(233,69,96,0.3)',
  },
  costText: { color: '#e94560', fontSize: 12, fontWeight: 'bold' },

  // 하단 액션 바
  actionBar: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    flexDirection: 'row', gap: 12, paddingHorizontal: 20, paddingTop: 12,
    backgroundColor: '#16213e', borderTopWidth: 1, borderTopColor: '#0f3460',
  },
  likeBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 20, paddingVertical: 14, borderRadius: 14,
    borderWidth: 1.5, borderColor: '#e94560', minWidth: 80,
  },
  likeBtnActive: { backgroundColor: '#e94560' },
  likeBtnText: { color: '#e94560', fontSize: 16, fontWeight: 'bold' },
  likeBtnTextActive: { color: '#fff' },
  copyBtn: {
    flex: 1, backgroundColor: '#4a9eff', paddingVertical: 14,
    borderRadius: 14, alignItems: 'center',
  },
  copyBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },

  // 복사 모달
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal: {
    backgroundColor: '#16213e', borderTopLeftRadius: 20, borderTopRightRadius: 20,
    padding: 24, maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { color: '#fff', fontSize: 17, fontWeight: 'bold' },
  modalClose: { color: '#aaa', fontSize: 20, padding: 4 },
  backBtn: { color: '#4a9eff', fontSize: 14, padding: 4 },

  selectAllRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12,
  },
  selectCountText: { color: '#aaa', fontSize: 13 },
  selectAllText: { color: '#4a9eff', fontSize: 13, fontWeight: 'bold' },

  scheduleList: { maxHeight: 320 },
  copyDayHeader: {
    color: '#e94560', fontSize: 12, fontWeight: 'bold',
    marginTop: 10, marginBottom: 6,
  },
  copyItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: '#1a1a2e', borderRadius: 10, padding: 12,
    marginBottom: 6, borderWidth: 1, borderColor: '#0f3460',
  },
  copyItemSelected: {
    borderColor: '#4a9eff', backgroundColor: 'rgba(74,158,255,0.08)',
  },
  checkbox: {
    width: 22, height: 22, borderRadius: 6,
    borderWidth: 1.5, borderColor: '#555',
    justifyContent: 'center', alignItems: 'center',
  },
  checkboxOn: { backgroundColor: '#4a9eff', borderColor: '#4a9eff' },
  checkmark: { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  copyItemInfo: { flex: 1 },
  copyItemTitle: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginBottom: 2 },
  copyItemTime: { color: '#4a9eff', fontSize: 12, marginBottom: 1 },
  copyItemLoc: { color: '#888', fontSize: 12 },

  nextBtn: {
    backgroundColor: '#e94560', padding: 14, borderRadius: 12,
    alignItems: 'center', marginTop: 12,
  },
  nextBtnDisabled: { backgroundColor: '#555' },
  nextBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },

  modeTabs: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  modeTab: {
    flex: 1, padding: 12, borderRadius: 12, alignItems: 'center',
    borderWidth: 1.5, borderColor: '#0f3460', backgroundColor: '#1a1a2e',
  },
  modeTabActive: { borderColor: '#4a9eff', backgroundColor: 'rgba(74,158,255,0.1)' },
  modeTabText: { color: '#aaa', fontSize: 13, fontWeight: 'bold' },
  modeTabTextActive: { color: '#4a9eff' },

  formInput: {
    backgroundColor: '#1a1a2e', color: '#fff', padding: 14,
    borderRadius: 10, marginBottom: 10, fontSize: 15,
    borderWidth: 1, borderColor: '#0f3460',
  },
  dateLabel: { color: '#aaa', fontSize: 13, marginBottom: 8 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a2e', borderRadius: 12, padding: 8, marginBottom: 14,
  },
  pickerSep: { color: '#aaa', fontSize: 14, marginHorizontal: 4 },
  confirmBtn: {
    backgroundColor: '#4a9eff', padding: 14, borderRadius: 12,
    alignItems: 'center', marginTop: 4,
  },
  confirmBtnDisabled: { opacity: 0.5 },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },

  myTripList: { maxHeight: 280 },
  myTripItem: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14,
    marginBottom: 8, borderWidth: 1, borderColor: '#0f3460',
  },
  myTripFlag: { fontSize: 28, marginRight: 12 },
  myTripInfo: { flex: 1 },
  myTripName: { color: '#fff', fontSize: 14, fontWeight: 'bold', marginBottom: 2 },
  myTripDest: { color: '#aaa', fontSize: 12 },
  myTripArrow: { color: '#aaa', fontSize: 24 },
  myTripItemDisabled: { opacity: 0.4 },
  myTripTextDisabled: { color: '#666' },
  myTripMismatch: { color: '#e94560', fontSize: 11, marginTop: 2 },
  noTripsText: { color: '#555', textAlign: 'center', marginTop: 20, fontSize: 14 },
});
