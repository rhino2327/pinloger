import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Modal,
  TextInput, Alert, ScrollView, Linking,
  KeyboardAvoidingView, Platform, ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection, addDoc, onSnapshot, query, where,
  serverTimestamp, deleteDoc, doc, updateDoc
} from 'firebase/firestore';
import { db, auth, functions } from '../config/firebase';
import { httpsCallable } from 'firebase/functions';
import ScrollPicker from '../components/ScrollPicker';
import { TRANSPORTS } from '../utils/transport';

const HOURS     = Array.from({ length: 24 }, (_, i) => String(i).padStart(2, '0'));
const MINUTES   = ['00', '10', '20', '30', '40', '50'];
const CURRENCIES = ['KRW', 'USD', 'JPY', 'EUR', 'CNY', 'THB', 'VND', 'GBP'];
const CATEGORIES = ['숙소', '교통', '식비', '관광', '쇼핑', '기타'];

function getDuration(startTime, endTime, crossDay = false) {
  if (!startTime || !endTime) return null;
  const [sh, sm] = startTime.split(':').map(Number);
  const [eh, em] = endTime.split(':').map(Number);
  let total = (eh * 60 + em) - (sh * 60 + sm);
  if (crossDay) total += 24 * 60;
  if (total <= 0) return null;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}분`;
  if (m === 0) return `${h}시간`;
  return `${h}시간 ${m}분`;
}

// 날짜 문자열 + n일 → YYYY-MM-DD
function addDays(dateStr, n) {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + n);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// "HH:MM" → 분 (자정 기준)
function toMin(t) {
  if (!t) return null;
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

// 특정 날짜에서 일정의 시간 범위 [start, end] (분, 자정 기준) 반환
// 다일자 일정인 경우 시작일에는 [start, 1440], 종료일에는 [0, end]
function getRangeOnDay(item, dayStr) {
  const startMin = toMin(item.time);
  const endMin   = toMin(item.endTime);
  if (startMin == null) return null;
  const startDay = item.date;
  const endDay   = item.endDate || item.date;
  // 시작일과 종료일 사이가 아니면 null
  if (dayStr < startDay || dayStr > endDay) return null;
  if (startDay === endDay) {
    // 단일일자
    if (endMin == null) return [startMin, startMin + 1]; // 시간만 있을 때 점으로
    return [startMin, endMin];
  }
  // 다일자
  if (dayStr === startDay) return [startMin, 24 * 60];
  if (dayStr === endDay)   return [0, endMin ?? 0];
  // 중간 일자 (3일 이상 걸치는 일정)
  return [0, 24 * 60];
}

// 두 시간 범위 겹침 여부
function rangesOverlap(a, b) {
  if (!a || !b) return false;
  return a[0] < b[1] && b[0] < a[1];
}

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

const EMPTY_FORM = {
  title: '',
  fromLocation: '', fromAddress: '', fromLat: null, fromLng: null,
  toLocation:   '', toAddress:   '', toLat:   null, toLng:   null,
  memo: '',
  hour: '09', minute: '00', useTime: true,
  endHour: '10', endMinute: '00', useEndTime: false,
  crossDay: false, // 다음 날까지 이어지는 일정
  transport: '', cost: '', currency: 'KRW', category: '기타', prepaid: false,
  flightNumber: '', flightStatus: '', flightDelay: 0, airline: '', checkInMins: 120,
  depAirport: '', depIata: '', depTerminal: '', depGate: '', depCheckInDesk: '',
  arrAirport: '', arrIata: '', arrTerminal: '', arrGate: '',
};

// ── 장소 검색 결과 패널 ─────────────────────────────────────
function PlacesPanel({ results, searching, showPlaces, onSelect }) {
  if (!showPlaces) return null;
  return (
    <View style={styles.placesList}>
      {searching ? (
        <View style={styles.placesLoadRow}>
          <ActivityIndicator size="small" color="#e94560" />
          <Text style={styles.placesLoadText}>장소 검색 중...</Text>
        </View>
      ) : results.length === 0 ? (
        <Text style={styles.noPlacesText}>검색 결과가 없어요</Text>
      ) : (
        results.map((place, idx) => (
          <TouchableOpacity
            key={idx}
            style={[styles.placeItem, idx < results.length - 1 && styles.placeItemBorder]}
            onPress={() => onSelect(place)}
          >
            <View style={styles.placeItemLeft}>
              <Text style={styles.placeName}>{place.name}</Text>
              {place.address ? (
                <Text style={styles.placeAddr} numberOfLines={1}>{place.address}</Text>
              ) : null}
            </View>
            {place.category ? (
              <View style={styles.placeCatBadge}>
                <Text style={styles.placeCatText}>{place.category}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        ))
      )}
    </View>
  );
}

// ── 항공편 상세 모달 ──────────────────────────────────────
function FlightDetailModal({ visible, item, onClose }) {
  if (!item) return null;
  const depTime  = item.time    || '';
  const arrTime  = item.endTime || '';
  const checkInMins = item.checkInMins || 120;

  // 수속 권장 시간 계산
  const checkInTime = (() => {
    if (!depTime) return null;
    const [h, m] = depTime.split(':').map(Number);
    const total  = h * 60 + m - checkInMins;
    if (total < 0) return null;
    return `${String(Math.floor(total / 60)).padStart(2,'0')}:${String(total % 60).padStart(2,'0')}`;
  })();

  const statusColor = {
    'active':    '#4aff91',
    'landed':    '#4aff91',
    'scheduled': '#4a9eff',
    'cancelled': '#e94560',
  }[item.flightStatus?.toLowerCase()] || '#aaa';

  const statusLabel = {
    'active':    '운항 중',
    'landed':    '착륙 완료',
    'scheduled': '운항 예정',
    'cancelled': '결항',
  }[item.flightStatus?.toLowerCase()] || item.flightStatus || '정보 없음';

  const Row = ({ icon, label, value }) => value ? (
    <View style={fdStyles.row}>
      <Text style={fdStyles.rowIcon}>{icon}</Text>
      <Text style={fdStyles.rowLabel}>{label}</Text>
      <Text style={fdStyles.rowValue}>{value}</Text>
    </View>
  ) : null;

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={fdStyles.overlay}>
        <View style={fdStyles.sheet}>
          {/* 헤더 */}
          <View style={fdStyles.header}>
            <View>
              <Text style={fdStyles.flightNo}>✈️ {item.flightNumber}</Text>
              {item.airline ? <Text style={fdStyles.airline}>{item.airline}</Text> : null}
            </View>
            <View style={[fdStyles.statusBadge, { borderColor: statusColor }]}>
              <Text style={[fdStyles.statusText, { color: statusColor }]}>{statusLabel}</Text>
            </View>
          </View>

          {/* 노선 */}
          <View style={fdStyles.routeRow}>
            <View style={fdStyles.routeEnd}>
              <Text style={fdStyles.iata}>{item.depIata || '???'}</Text>
              <Text style={fdStyles.airport} numberOfLines={2}>{item.depAirport}</Text>
              {depTime ? <Text style={fdStyles.time}>{depTime}</Text> : null}
              {item.flightDelay > 0 && (
                <Text style={fdStyles.delay}>
                  +{item.flightDelay}분 지연
                </Text>
              )}
            </View>
            <View style={fdStyles.routeMid}>
              <Text style={fdStyles.arrow}>──────</Text>
              <Text style={fdStyles.arrowIcon}>✈</Text>
              <Text style={fdStyles.arrow}>──────</Text>
            </View>
            <View style={[fdStyles.routeEnd, { alignItems: 'flex-end' }]}>
              <Text style={fdStyles.iata}>{item.arrIata || '???'}</Text>
              <Text style={[fdStyles.airport, { textAlign: 'right' }]} numberOfLines={2}>{item.arrAirport}</Text>
              {arrTime ? <Text style={fdStyles.time}>{arrTime}</Text> : null}
            </View>
          </View>

          {/* 상세 정보 */}
          <View style={fdStyles.detailBox}>
            <Row icon="🏢" label="출발 터미널" value={item.depTerminal} />
            <Row icon="🚪" label="출발 게이트" value={item.depGate} />
            <Row icon="🎫" label="체크인 카운터" value={item.depCheckInDesk} />
            <Row icon="🏢" label="도착 터미널" value={item.arrTerminal} />
            <Row icon="🚪" label="도착 게이트" value={item.arrGate} />
            {checkInTime && (
              <View style={[fdStyles.row, fdStyles.checkInRow]}>
                <Text style={fdStyles.rowIcon}>⏰</Text>
                <Text style={fdStyles.rowLabel}>수속 권장 시각</Text>
                <Text style={[fdStyles.rowValue, { color: '#e94560', fontWeight: 'bold' }]}>
                  {checkInTime} ({checkInMins}분 전)
                </Text>
              </View>
            )}
          </View>

          <TouchableOpacity style={fdStyles.closeBtn} onPress={onClose}>
            <Text style={fdStyles.closeBtnText}>닫기</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const fdStyles = StyleSheet.create({
  overlay:     { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  sheet:       { backgroundColor: '#16213e', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24, paddingBottom: 36 },
  header:      { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 },
  flightNo:    { color: '#fff', fontSize: 22, fontWeight: 'bold' },
  airline:     { color: '#aaa', fontSize: 14, marginTop: 2 },
  statusBadge: { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  statusText:  { fontSize: 12, fontWeight: 'bold' },
  routeRow:    { flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  routeEnd:    { flex: 1, alignItems: 'flex-start' },
  routeMid:    { alignItems: 'center', paddingHorizontal: 4 },
  iata:        { color: '#fff', fontSize: 24, fontWeight: 'bold', letterSpacing: 1 },
  airport:     { color: '#888', fontSize: 11, marginTop: 2, flexShrink: 1 },
  time:        { color: '#4a9eff', fontSize: 16, fontWeight: 'bold', marginTop: 4 },
  delay:       { color: '#ffa500', fontSize: 11, marginTop: 2 },
  arrow:       { color: '#0f3460', fontSize: 10 },
  arrowIcon:   { color: '#4a9eff', fontSize: 18 },
  detailBox:   { backgroundColor: '#1a1a2e', borderRadius: 12, padding: 14, marginBottom: 16 },
  row:         { flexDirection: 'row', alignItems: 'center', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.05)' },
  checkInRow:  { borderBottomWidth: 0 },
  rowIcon:     { fontSize: 16, width: 28 },
  rowLabel:    { color: '#888', fontSize: 13, flex: 1 },
  rowValue:    { color: '#fff', fontSize: 13, fontWeight: '600', flexShrink: 1, textAlign: 'right' },
  closeBtn:    { backgroundColor: '#0f3460', padding: 14, borderRadius: 12, alignItems: 'center' },
  closeBtnText:{ color: '#fff', fontSize: 15, fontWeight: 'bold' },
});

// ── 메인 화면 ─────────────────────────────────────────────
export default function ScheduleScreen({ route }) {
  const { trip } = route.params;
  const [schedules,   setSchedules]   = useState([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingId,   setEditingId]   = useState(null);
  const [form,        setForm]        = useState(EMPTY_FORM);
  const [selectedDay, setSelectedDay] = useState(null);
  const [flightDetailItem, setFlightDetailItem] = useState(null);
  const [kebabOpenId, setKebabOpenId] = useState(null);

  const user    = auth.currentUser;
  const insets  = useSafeAreaInsets();
  const canEdit = ['owner', 'editor'].includes(trip.memberRoles?.[user.uid]);
  const tripDays = getTripDays(trip.startDate, trip.endDate);
  const [activeDay, setActiveDay] = useState(tripDays[0]?.date || null);

  // ── 출발지 검색 상태 ──
  const [fromQuery,     setFromQuery]     = useState('');
  const [fromResults,   setFromResults]   = useState([]);
  const [searchingFrom, setSearchingFrom] = useState(false);
  const [showFrom,      setShowFrom]      = useState(false);
  const fromDebounce = useRef(null);

  // ── 도착지 검색 상태 ──
  const [toQuery,     setToQuery]     = useState('');
  const [toResults,   setToResults]   = useState([]);
  const [searchingTo, setSearchingTo] = useState(false);
  const [showTo,      setShowTo]      = useState(false);
  const toDebounce = useRef(null);

  // 언마운트 시 타이머 정리
  useEffect(() => () => {
    if (fromDebounce.current)   clearTimeout(fromDebounce.current);
    if (toDebounce.current)     clearTimeout(toDebounce.current);
    if (flightDebounce.current) clearTimeout(flightDebounce.current);
  }, []);

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

  const setField = (key, value) => setForm(f => ({ ...f, [key]: value }));

  // ── 항공편 조회 ──
  const [flightLoading, setFlightLoading] = useState(false);
  const flightDebounce = useRef(null);

  const lookupFlight = async (number) => {
    if (!number || number.trim().length < 4) return;
    setFlightLoading(true);
    try {
      const fn = httpsCallable(functions, 'lookupFlight');
      const { data } = await fn({ flightNumber: number.trim() });
      if (data.found) {
        setForm(f => {
          const next = { ...f };
          // 시간 자동 입력
          if (data.depTime) {
            next.hour     = data.depTime.split(':')[0];
            next.minute   = data.depTime.split(':')[1];
            next.useTime  = true;
          }
          if (data.arrTime) {
            next.endHour    = data.arrTime.split(':')[0];
            next.endMinute  = data.arrTime.split(':')[1];
            next.useEndTime = true;
          }
          // 항공편 정보
          next.flightStatus   = data.status       || '';
          next.flightDelay    = data.depDelay      || 0;
          next.airline        = data.airline       || '';
          next.checkInMins    = data.checkInMins   || 120;
          next.depAirport     = data.depAirport    || '';
          next.depIata        = data.depIata       || '';
          next.depTerminal    = data.depTerminal   || '';
          next.depGate        = data.depGate       || '';
          next.depCheckInDesk = data.depCheckInDesk|| '';
          next.arrAirport     = data.arrAirport    || '';
          next.arrIata        = data.arrIata       || '';
          next.arrTerminal    = data.arrTerminal   || '';
          next.arrGate        = data.arrGate       || '';
          // 출발지/도착지 자동 입력 (비어 있을 때만)
          if (data.depAirport && !f.fromLocation) {
            const depLabel = data.depIata
              ? `${data.depAirport} (${data.depIata})`
              : data.depAirport;
            next.fromLocation = depLabel;
            next.fromAddress  = depLabel;
          }
          if (data.arrAirport && !f.toLocation) {
            const arrLabel = data.arrIata
              ? `${data.arrAirport} (${data.arrIata})`
              : data.arrAirport;
            next.toLocation = arrLabel;
            next.toAddress  = arrLabel;
          }
          // 제목 자동 입력
          if (!f.title) {
            next.title = `${number.toUpperCase()} ${data.airline || ''}`.trim();
          }
          return next;
        });
        // fromQuery / toQuery 동기화
        if (data.depAirport) {
          setFromQuery(data.depIata
            ? `${data.depAirport} (${data.depIata})`
            : data.depAirport);
        }
        if (data.arrAirport) {
          setToQuery(data.arrIata
            ? `${data.arrAirport} (${data.arrIata})`
            : data.arrAirport);
        }
      } else {
        Alert.alert('항공편 조회', '항공편 정보를 찾을 수 없어요.\n편명을 다시 확인해주세요. (예: KE123)');
      }
    } catch {
      // 조회 실패 무시
    } finally {
      setFlightLoading(false);
    }
  };

  const handleFlightNumberChange = (text) => {
    setField('flightNumber', text);
    if (flightDebounce.current) clearTimeout(flightDebounce.current);
    if (text.trim().length >= 4) {
      flightDebounce.current = setTimeout(() => lookupFlight(text), 800);
    }
  };

  // ── 공통 Google 장소 검색 ──
  const searchPlaces = async (text, setResults, setSearching) => {
    setSearching(true);
    try {
      const fn = httpsCallable(functions, 'googlePlaceSearch');
      const { data } = await fn({ query: text.trim() });
      setResults(data.places || []);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  };

  // ── 출발지 핸들러 ──
  const handleFromChange = (text) => {
    setFromQuery(text);
    setField('fromLocation', text);
    setField('fromAddress', '');
    setField('fromLat', null);
    setField('fromLng', null);
    if (fromDebounce.current) clearTimeout(fromDebounce.current);
    if (text.trim().length < 2) {
      setFromResults([]); setShowFrom(false); setSearchingFrom(false); return;
    }
    setSearchingFrom(true);
    setShowFrom(true);
    fromDebounce.current = setTimeout(() => searchPlaces(text, setFromResults, setSearchingFrom), 400);
  };

  const selectFrom = (place) => {
    setFromQuery(place.name);
    setField('fromLocation', place.name);
    setField('fromAddress', place.address);
    setField('fromLat', parseFloat(place.y) || null);
    setField('fromLng', parseFloat(place.x) || null);
    setFromResults([]);
    setShowFrom(false);
  };

  const clearFrom = () => {
    setFromQuery('');
    setField('fromLocation', ''); setField('fromAddress', '');
    setField('fromLat', null);    setField('fromLng', null);
    setFromResults([]); setShowFrom(false);
  };

  // ── 도착지 핸들러 ──
  const handleToChange = (text) => {
    setToQuery(text);
    setField('toLocation', text);
    setField('toAddress', '');
    setField('toLat', null);
    setField('toLng', null);
    if (toDebounce.current) clearTimeout(toDebounce.current);
    if (text.trim().length < 2) {
      setToResults([]); setShowTo(false); setSearchingTo(false); return;
    }
    setSearchingTo(true);
    setShowTo(true);
    toDebounce.current = setTimeout(() => searchPlaces(text, setToResults, setSearchingTo), 400);
  };

  const selectTo = (place) => {
    setToQuery(place.name);
    setField('toLocation', place.name);
    setField('toAddress', place.address);
    setField('toLat', parseFloat(place.y) || null);
    setField('toLng', parseFloat(place.x) || null);
    setToResults([]);
    setShowTo(false);
  };

  const clearTo = () => {
    setToQuery('');
    setField('toLocation', ''); setField('toAddress', '');
    setField('toLat', null);    setField('toLng', null);
    setToResults([]); setShowTo(false);
  };

  // ── CRUD ──
  const openAdd = () => {
    setEditingId(null);
    setSelectedDay(activeDay);
    // 현재 선택된 날의 마지막 일정 종료시간을 기본 시작시간으로
    const sameDay = schedules.filter(s => (s.date === activeDay) && s.time);
    let initHour = EMPTY_FORM.hour, initMin = EMPTY_FORM.minute;
    if (sameDay.length > 0) {
      // 가장 늦은 종료시간(없으면 시작시간 + 1시간) 찾기
      let latestMin = -1;
      sameDay.forEach(s => {
        const t = s.endTime || s.time;
        const [h, m] = t.split(':').map(Number);
        const mm = h * 60 + m;
        if (mm > latestMin) latestMin = mm;
      });
      if (latestMin >= 0 && latestMin < 24 * 60) {
        // 분을 10분 단위로 올림
        const rounded = Math.ceil(latestMin / 10) * 10;
        const h = Math.floor(rounded / 60) % 24;
        const m = rounded % 60;
        initHour = String(h).padStart(2, '0');
        initMin  = String(m).padStart(2, '0');
      }
    }
    setForm({ ...EMPTY_FORM, hour: initHour, minute: initMin });
    setFromQuery(''); setFromResults([]); setShowFrom(false);
    setToQuery('');   setToResults([]);   setShowTo(false);
    setModalVisible(true);
  };

  const openEdit = (item) => {
    setEditingId(item.id);
    setSelectedDay(item.date);
    // 구형 데이터(location 단일 필드)와 신형(from/to) 모두 지원
    const legacyTo   = item.toLocation   || item.location        || '';
    const legacyAddr = item.toAddress    || item.locationAddress  || '';
    const legacyLat  = item.toLat        || item.lat              || null;
    const legacyLng  = item.toLng        || item.lng              || null;
    setForm({
      title:        item.title        || '',
      fromLocation: item.fromLocation || '',
      fromAddress:  item.fromAddress  || '',
      fromLat:      item.fromLat      || null,
      fromLng:      item.fromLng      || null,
      toLocation:   legacyTo,
      toAddress:    legacyAddr,
      toLat:        legacyLat,
      toLng:        legacyLng,
      memo:         item.memo         || '',
      hour:         item.time    ? item.time.split(':')[0]    : '09',
      minute:       item.time    ? item.time.split(':')[1]    : '00',
      useTime:      !!item.time,
      endHour:      item.endTime ? item.endTime.split(':')[0] : '10',
      endMinute:    item.endTime ? item.endTime.split(':')[1] : '00',
      useEndTime:   !!item.endTime,
      crossDay:     !!(item.endDate && item.endDate !== item.date),
      transport:    item.transport    || '',
      cost:         item.cost ? String(item.cost) : '',
      currency:     item.currency     || 'KRW',
      category:     item.category     || '기타',
      prepaid:      !!item.prepaid,
      flightNumber:   item.flightNumber    || '',
      flightStatus:   item.flightStatus    || '',
      flightDelay:    item.flightDelay     || 0,
      airline:        item.airline         || '',
      checkInMins:    item.checkInMins     || 120,
      depAirport:     item.depAirport      || '',
      depIata:        item.depIata         || '',
      depTerminal:    item.depTerminal     || '',
      depGate:        item.depGate         || '',
      depCheckInDesk: item.depCheckInDesk  || '',
      arrAirport:     item.arrAirport      || '',
      arrIata:        item.arrIata         || '',
      arrTerminal:    item.arrTerminal     || '',
      arrGate:        item.arrGate         || '',
    });
    setFromQuery(item.fromLocation || '');
    setToQuery(legacyTo);
    setFromResults([]); setShowFrom(false);
    setToResults([]);   setShowTo(false);
    setModalVisible(true);
  };

  const saveSchedule = async () => {
    if (!form.title.trim()) { Alert.alert('알림', '제목을 입력해주세요.'); return; }

    // 다일자 일정 종료일 계산
    const startTime = form.useTime ? `${form.hour}:${form.minute}` : '';
    const endTime   = (form.useTime && form.useEndTime) ? `${form.endHour}:${form.endMinute}` : '';
    const endDate   = (form.useTime && form.useEndTime && form.crossDay)
      ? addDays(selectedDay, 1)
      : selectedDay;

    // 종료 시간이 시작 시간보다 빠른데 crossDay가 아니면 경고
    if (form.useTime && form.useEndTime && !form.crossDay) {
      const sMin = toMin(startTime);
      const eMin = toMin(endTime);
      if (eMin <= sMin) {
        Alert.alert('알림', '종료 시간이 시작 시간보다 빠릅니다.\n다음 날까지 이어지는 일정이면 "다음 날까지"를 켜주세요.');
        return;
      }
    }

    // ── 겹침 검사 ──
    if (form.useTime) {
      const newItem = { date: selectedDay, endDate, time: startTime, endTime };
      const datesToCheck = endDate === selectedDay ? [selectedDay] : [selectedDay, endDate];
      const conflict = schedules.find(s => {
        if (editingId && s.id === editingId) return false; // 자기 자신은 제외
        if (!s.time) return false; // 시간 미정 일정은 제외
        return datesToCheck.some(d => {
          const r1 = getRangeOnDay(newItem, d);
          const r2 = getRangeOnDay(s, d);
          return rangesOverlap(r1, r2);
        });
      });
      if (conflict) {
        Alert.alert('겹치는 일정이 있습니다', `"${conflict.title}" 일정과 시간이 겹쳐요.\n수정 후 다시 시도해주세요.`);
        return;
      }
    }

    const data = {
      title:        form.title.trim(),
      fromLocation: form.fromLocation || '',
      fromAddress:  form.fromAddress  || '',
      fromLat:      form.fromLat      || null,
      fromLng:      form.fromLng      || null,
      toLocation:   form.toLocation   || '',
      toAddress:    form.toAddress    || '',
      toLat:        form.toLat        || null,
      toLng:        form.toLng        || null,
      // 하위 호환 필드 (구형 코드/CostScreen 등에서 사용)
      location:        (form.toLocation  || form.fromLocation || '').trim(),
      locationAddress: (form.toAddress   || form.fromAddress  || ''),
      lat:              form.toLat        || form.fromLat      || null,
      lng:              form.toLng        || form.fromLng      || null,
      memo:             form.memo.trim(),
      time:             startTime,
      endTime:          endTime,
      endDate:          endDate,
      crossDay:         (form.useTime && form.useEndTime && form.crossDay) ? true : false,
      transport:        form.transport,
      cost:             form.cost ? Number(form.cost) : 0,
      currency:         form.currency,
      category:         form.category || '기타',
      prepaid:          !!form.prepaid,
      flightNumber:     form.transport === '✈️' ? (form.flightNumber    || '') : '',
      flightStatus:     form.transport === '✈️' ? (form.flightStatus    || '') : '',
      flightDelay:      form.transport === '✈️' ? (form.flightDelay     || 0)  : 0,
      airline:          form.transport === '✈️' ? (form.airline         || '') : '',
      checkInMins:      form.transport === '✈️' ? (form.checkInMins     || 120): 0,
      depAirport:       form.transport === '✈️' ? (form.depAirport      || '') : '',
      depIata:          form.transport === '✈️' ? (form.depIata         || '') : '',
      depTerminal:      form.transport === '✈️' ? (form.depTerminal     || '') : '',
      depGate:          form.transport === '✈️' ? (form.depGate         || '') : '',
      depCheckInDesk:   form.transport === '✈️' ? (form.depCheckInDesk  || '') : '',
      arrAirport:       form.transport === '✈️' ? (form.arrAirport      || '') : '',
      arrIata:          form.transport === '✈️' ? (form.arrIata         || '') : '',
      arrTerminal:      form.transport === '✈️' ? (form.arrTerminal     || '') : '',
      arrGate:          form.transport === '✈️' ? (form.arrGate         || '') : '',
    };
    try {
      if (editingId) {
        await updateDoc(doc(db, 'schedules', editingId), data);
      } else {
        await addDoc(collection(db, 'schedules'), {
          ...data, tripId: trip.id, date: selectedDay, createdAt: serverTimestamp(),
        });
      }
      setModalVisible(false);
    } catch (e) {
      Alert.alert('오류', '일정 저장에 실패했어요. 다시 시도해주세요.');
    }
  };

  const deleteSchedule = (id) => {
    Alert.alert('삭제', '이 일정을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: () => deleteDoc(doc(db, 'schedules', id)) },
    ]);
  };

  const openMaps = (location, lat, lng) => {
    const q = (lat && lng) ? `${lat},${lng}` : encodeURIComponent(location || '');
    Linking.openURL(`https://www.google.com/maps/search/?api=1&query=${q}`);
  };

  // 출발지→도착지 구글맵 길찾기 열기
  const openDirections = (item) => {
    const o = (item.fromLat && item.fromLng) ? `${item.fromLat},${item.fromLng}` : encodeURIComponent(item.fromLocation || '');
    const d = (item.toLat && item.toLng)     ? `${item.toLat},${item.toLng}`     : encodeURIComponent(item.toLocation || item.location || '');
    if (!o || !d) return;
    // 이동수단 추정: ✈️→ flight(미지원, driving), 🚗 driving, 🚇/🚌→ transit, 🚶→ walking
    const trans = item.transport || '';
    let mode = 'driving';
    if (trans === '🚇' || trans === '🚌' || trans === '🚆') mode = 'transit';
    else if (trans === '🚶') mode = 'walking';
    else if (trans === '🚲') mode = 'bicycling';
    Linking.openURL(`https://www.google.com/maps/dir/?api=1&origin=${o}&destination=${d}&travelmode=${mode}`);
  };

  // ── 일정별 이동시간 캐시 (출발지→도착지 좌표 동시 있을 때만) ──
  const [routeInfo, setRouteInfo] = useState({}); // { [scheduleId]: { durationText, distanceText, mode } }

  useEffect(() => {
    let cancelled = false;
    const fn = httpsCallable(functions, 'googleDirections');
    schedules.forEach(s => {
      if (routeInfo[s.id]) return;
      if (!s.fromLat || !s.fromLng || !s.toLat || !s.toLng) return;
      const trans = s.transport || '';
      let mode = 'driving';
      if (trans === '🚇' || trans === '🚌' || trans === '🚆') mode = 'transit';
      else if (trans === '🚶') mode = 'walking';
      else if (trans === '🚲') mode = 'bicycling';
      fn({
        origin:      { lat: s.fromLat, lng: s.fromLng },
        destination: { lat: s.toLat,   lng: s.toLng },
        mode,
      }).then(({ data }) => {
        if (cancelled || !data?.ok) return;
        setRouteInfo(prev => ({
          ...prev,
          [s.id]: { durationText: data.durationText, distanceText: data.distanceText, mode: data.mode },
        }));
      }).catch(() => {});
    });
    return () => { cancelled = true; };
  }, [schedules.map(s => `${s.id}:${s.fromLat},${s.fromLng}-${s.toLat},${s.toLng}-${s.transport}`).join('|')]);

  // 다일자 일정은 시작일·종료일·중간일에 모두 표시
  const daySchedules = schedules
    .filter(s => {
      const start = s.date;
      const end   = s.endDate || s.date;
      return start <= activeDay && activeDay <= end;
    })
    .sort((a, b) => {
      // 현재 날짜에 보여줄 시작 시간 기준 정렬
      const aIsContinuation = a.date !== activeDay; // 이전 날에서 이어진 일정
      const bIsContinuation = b.date !== activeDay;
      const aTime = aIsContinuation ? '00:00' : (a.time || '');
      const bTime = bIsContinuation ? '00:00' : (b.time || '');
      return aTime > bTime ? 1 : -1;
    });

  if (tripDays.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.noDatesBox}>
          <Text style={styles.noDatesText}>여행 기간이 설정되지 않았어요.</Text>
          <Text style={styles.noDatesHint}>홈 화면에서 새 여행 만들 때 기간을 설정해주세요.</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>

      {/* ── DAY 탭 ── */}
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
              <Text style={[styles.dayTabDate,  isActive && styles.dayTabDateActive]}>{day.date.slice(5)}</Text>
              {count > 0 && (
                <View style={styles.badge}><Text style={styles.badgeText}>{count}</Text></View>
              )}
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── 일정 목록 ── */}
      <ScrollView contentContainerStyle={styles.scroll}>
        {daySchedules.length === 0 ? (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>이 날 일정이 없어요</Text>
            {canEdit && <Text style={styles.emptyHint}>+ 버튼으로 추가해보세요!</Text>}
          </View>
        ) : (
          daySchedules.map((item, index) => {
            const hasFrom = !!item.fromLocation;
            const hasTo   = !!(item.toLocation || item.location);
            return (
              <View key={item.id} style={styles.scheduleRow}>
                <View style={styles.timeline}>
                  <View style={styles.dot} />
                  {index < daySchedules.length - 1 && <View style={styles.line} />}
                </View>
                <View style={styles.scheduleCard}>

                  {/* 헤더 */}
                  <View style={styles.cardHeader}>
                    <View style={styles.timeBlock}>
                      <Text style={styles.scheduleTime}>
                        {(() => {
                          if (!item.time) return '시간 미정';
                          const startDay = item.date;
                          const endDay   = item.endDate || item.date;
                          const isMulti  = startDay !== endDay;
                          if (!isMulti) {
                            return item.endTime ? `${item.time} ~ ${item.endTime}` : item.time;
                          }
                          // 다일자
                          if (activeDay === startDay)  return `${item.time} ~`;
                          if (activeDay === endDay)    return `~ ${item.endTime || ''}`;
                          return '종일';
                        })()}
                      </Text>
                      {item.time && item.endTime && getDuration(item.time, item.endTime, item.crossDay) && (
                        <View style={styles.durationBadge}>
                          <Text style={styles.durationText}>
                            ⏱ {getDuration(item.time, item.endTime, item.crossDay)}
                          </Text>
                        </View>
                      )}
                      {(item.endDate && item.endDate !== item.date) && (
                        <View style={[styles.durationBadge, { backgroundColor: 'rgba(74,158,255,0.15)' }]}>
                          <Text style={[styles.durationText, { color: '#4a9eff' }]}>↗ 다음 날까지</Text>
                        </View>
                      )}
                    </View>
                    {canEdit && (
                      <TouchableOpacity
                        style={styles.kebabBtn}
                        onPress={() => setKebabOpenId(kebabOpenId === item.id ? null : item.id)}
                      >
                        <Text style={styles.kebabText}>⋮</Text>
                      </TouchableOpacity>
                    )}
                    {kebabOpenId === item.id && (
                      <View style={styles.kebabMenu}>
                        <TouchableOpacity
                          style={styles.kebabMenuItem}
                          onPress={() => { setKebabOpenId(null); openEdit(item); }}
                        >
                          <Text style={styles.kebabMenuText}>✏️ 수정</Text>
                        </TouchableOpacity>
                        <View style={styles.kebabDivider} />
                        <TouchableOpacity
                          style={styles.kebabMenuItem}
                          onPress={() => { setKebabOpenId(null); deleteSchedule(item.id); }}
                        >
                          <Text style={[styles.kebabMenuText, { color: '#e94560' }]}>🗑️ 삭제</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  {/* 이동수단 */}
                  {item.transport && (
                    <TouchableOpacity
                      style={styles.transportBadge}
                      onPress={() => item.flightNumber ? setFlightDetailItem(item) : null}
                      activeOpacity={item.flightNumber ? 0.7 : 1}
                    >
                      <Text style={styles.transportText}>
                        {TRANSPORTS.find(t => t.emoji === item.transport)?.emoji}{' '}
                        {TRANSPORTS.find(t => t.emoji === item.transport)?.label}
                        {item.flightNumber ? `  ${item.flightNumber}` : ''}
                        {item.flightNumber ? '  ›' : ''}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* 출발→도착 이동시간 (구글맵 기준) */}
                  {hasFrom && hasTo && routeInfo[item.id] && (
                    <TouchableOpacity
                      style={styles.routeDurationBadge}
                      onPress={() => openDirections(item)}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.routeDurationText}>
                        🗺 {routeInfo[item.id].durationText}
                        {routeInfo[item.id].distanceText ? `  ·  ${routeInfo[item.id].distanceText}` : ''}
                        {'  ›'}
                      </Text>
                    </TouchableOpacity>
                  )}

                  {/* 항공편 지연 배지 */}
                  {item.flightDelay > 0 && (
                    <View style={styles.flightDelayBadge}>
                      <Text style={styles.flightDelayText}>
                        ⚠️ {Math.floor(item.flightDelay/60) > 0
                          ? `${Math.floor(item.flightDelay/60)}시간 `
                          : ''}{item.flightDelay % 60}분 지연
                      </Text>
                    </View>
                  )}

                  <Text style={styles.scheduleTitle}>{item.title}</Text>

                  {/* 출발지 / 도착지 */}
                  {(hasFrom || hasTo) ? (
                    <View style={styles.routeBox}>
                      {/* 출발지 */}
                      {hasFrom && (
                        <TouchableOpacity
                          style={styles.locationRow}
                          onPress={() => openMaps(item.fromLocation, item.fromLat, item.fromLng)}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.locFromText}>🚀 {item.fromLocation}</Text>
                            {item.fromAddress ? (
                              <Text style={styles.locAddrText}>{item.fromAddress}</Text>
                            ) : null}
                          </View>
                          <Text style={styles.mapLink}>지도 →</Text>
                        </TouchableOpacity>
                      )}

                      {/* 출발→도착 연결선 */}
                      {hasFrom && hasTo && (
                        <View style={styles.routeDivider}>
                          <View style={styles.routeLine} />
                          <Text style={styles.routeArrow}>▼</Text>
                          <View style={styles.routeLine} />
                        </View>
                      )}

                      {/* 도착지 (구형 location 필드 fallback 포함) */}
                      {hasTo && (
                        <TouchableOpacity
                          style={styles.locationRow}
                          onPress={() => openMaps(
                            item.toLocation || item.location,
                            item.toLat || item.lat,
                            item.toLng || item.lng,
                          )}
                        >
                          <View style={{ flex: 1 }}>
                            <Text style={styles.locToText}>
                              📍 {item.toLocation || item.location}
                            </Text>
                            {(item.toAddress || item.locationAddress) ? (
                              <Text style={styles.locAddrText}>
                                {item.toAddress || item.locationAddress}
                              </Text>
                            ) : null}
                          </View>
                          <Text style={styles.mapLink}>지도 →</Text>
                        </TouchableOpacity>
                      )}
                    </View>
                  ) : null}

                  {item.memo ? <Text style={styles.memoText}>📝 {item.memo}</Text> : null}

                  {item.cost > 0 && (
                    <View style={styles.costRow}>
                      <Text style={styles.costText}>💰 {item.cost.toLocaleString()} {item.currency}</Text>
                    </View>
                  )}
                </View>
              </View>
            );
          })
        )}
      </ScrollView>

      {canEdit && (
        <TouchableOpacity
          style={[styles.fab, { bottom: insets.bottom + 20 }]}
          onPress={openAdd}
        >
          <Text style={styles.fabText}>+ 일정 추가</Text>
        </TouchableOpacity>
      )}

      {/* ── 추가/수정 모달 ── */}
      <Modal visible={modalVisible} transparent animationType="slide">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.modalOverlay}>
            <ScrollView keyboardShouldPersistTaps="handled">
              <View style={[styles.modal, { paddingBottom: insets.bottom + 24 }]}>
                <Text style={styles.modalTitle}>{editingId ? '일정 수정' : '일정 추가'}</Text>
                <Text style={styles.modalDayLabel}>
                  {tripDays.find(d => d.date === selectedDay)?.label} · {selectedDay}
                </Text>

                {/* 제목 */}
                <TextInput style={styles.input} placeholder="제목 *" placeholderTextColor="#aaa"
                  value={form.title} onChangeText={v => setField('title', v)} />

                {/* 시간 */}
                <View style={styles.rowHeader}>
                  <Text style={styles.inputLabel}>시간</Text>
                  <TouchableOpacity onPress={() => {
                    const next = !form.useTime;
                    setField('useTime', next);
                    if (!next) setField('useEndTime', false);
                  }}>
                    <Text style={styles.toggle}>{form.useTime ? '🔵 포함' : '⚫ 제외'}</Text>
                  </TouchableOpacity>
                </View>
                {form.useTime && (
                  <>
                    {/* 시작 시간 */}
                    <View style={styles.timeRowWrap}>
                      <Text style={styles.timeLabelTxt}>시작</Text>
                      <View style={styles.pickerRow}>
                        <ScrollPicker items={HOURS}   selectedValue={form.hour}   onValueChange={v => setField('hour', v)}   width={80} />
                        <Text style={styles.sep}>시</Text>
                        <ScrollPicker items={MINUTES} selectedValue={form.minute} onValueChange={v => setField('minute', v)} width={80} />
                        <Text style={styles.sep}>분</Text>
                      </View>
                      <TouchableOpacity
                        style={[styles.endToggleBtn, form.useEndTime && styles.endToggleBtnOn]}
                        onPress={() => setField('useEndTime', !form.useEndTime)}
                      >
                        <Text style={[styles.endToggleTxt, form.useEndTime && styles.endToggleTxtOn]}>
                          {form.useEndTime ? '종료 ✓' : '+ 종료'}
                        </Text>
                      </TouchableOpacity>
                    </View>

                    {/* 종료 시간 */}
                    {form.useEndTime && (
                      <>
                        <View style={styles.timeRowWrap}>
                          <Text style={styles.timeLabelTxt}>종료</Text>
                          <View style={styles.pickerRow}>
                            <ScrollPicker items={HOURS}   selectedValue={form.endHour}   onValueChange={v => setField('endHour', v)}   width={80} />
                            <Text style={styles.sep}>시</Text>
                            <ScrollPicker items={MINUTES} selectedValue={form.endMinute} onValueChange={v => setField('endMinute', v)} width={80} />
                            <Text style={styles.sep}>분</Text>
                          </View>
                        </View>
                        <TouchableOpacity
                          style={[styles.crossDayBtn, form.crossDay && styles.crossDayBtnOn]}
                          onPress={() => setField('crossDay', !form.crossDay)}
                        >
                          <Text style={[styles.crossDayTxt, form.crossDay && styles.crossDayTxtOn]}>
                            {form.crossDay ? '✓ 다음 날까지 이어짐' : '↗ 다음 날까지 이어지나요?'}
                          </Text>
                        </TouchableOpacity>
                      </>
                    )}
                  </>
                )}

                {/* 이동수단 */}
                <View style={{ height: form.useTime ? 6 : 0 }} />
                <Text style={styles.inputLabel}>이동수단</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.transportScroll}>
                  <TouchableOpacity
                    style={[styles.transportChip, !form.transport && styles.transportChipActive]}
                    onPress={() => setField('transport', '')}>
                    <Text style={styles.transportChipText}>없음</Text>
                  </TouchableOpacity>
                  {TRANSPORTS.map(t => (
                    <TouchableOpacity key={t.emoji}
                      style={[styles.transportChip, form.transport === t.emoji && styles.transportChipActive]}
                      onPress={() => setField('transport', t.emoji)}>
                      <Text style={styles.transportEmoji}>{t.emoji}</Text>
                      <Text style={[styles.transportChipText, form.transport === t.emoji && styles.transportChipTextActive]}>
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                {/* ════ 항공편 번호 (비행기 선택 시) ════ */}
                {form.transport === '✈️' && (
                  <View style={styles.flightBox}>
                    <Text style={styles.inputLabel}>항공편 번호</Text>
                    <View style={styles.flightInputRow}>
                      <TextInput
                        style={[styles.input, { flex: 1, marginBottom: 0 }]}
                        placeholder="예: KE123, OZ201"
                        placeholderTextColor="#555"
                        value={form.flightNumber}
                        onChangeText={handleFlightNumberChange}
                        autoCapitalize="characters"
                        returnKeyType="search"
                      />
                      {flightLoading && (
                        <ActivityIndicator
                          size="small" color="#e94560"
                          style={{ marginLeft: 10 }}
                        />
                      )}
                    </View>

                    {/* 조회 결과 배지 */}
                    {(form.depAirport || form.arrAirport) && (
                      <View style={styles.flightInfoCard}>
                        <View style={styles.flightRoute}>
                          <View style={styles.flightAirportBox}>
                            <Text style={styles.flightIataCode}>{form.depIata || '?'}</Text>
                            <Text style={styles.flightAirportName} numberOfLines={2}>
                              {form.depAirport || ''}
                            </Text>
                          </View>
                          <View style={styles.flightArrowBox}>
                            <Text style={styles.flightArrow}>✈️</Text>
                            <View style={styles.flightArrowLine} />
                          </View>
                          <View style={[styles.flightAirportBox, { alignItems: 'flex-end' }]}>
                            <Text style={styles.flightIataCode}>{form.arrIata || '?'}</Text>
                            <Text style={[styles.flightAirportName, { textAlign: 'right' }]} numberOfLines={2}>
                              {form.arrAirport || ''}
                            </Text>
                          </View>
                        </View>
                        {form.flightDelay > 0 && (
                          <View style={styles.delayBadge}>
                            <Text style={styles.delayText}>
                              ⚠️ {Math.floor(form.flightDelay/60) > 0
                                ? `${Math.floor(form.flightDelay/60)}시간 `
                                : ''}{form.flightDelay % 60}분 지연
                            </Text>
                          </View>
                        )}
                        {form.flightStatus === 'landed' && (
                          <View style={[styles.delayBadge, { backgroundColor: 'rgba(74,255,145,0.1)', borderColor: 'rgba(74,255,145,0.3)' }]}>
                            <Text style={[styles.delayText, { color: '#4aff91' }]}>✅ 착륙 완료</Text>
                          </View>
                        )}
                      </View>
                    )}
                  </View>
                )}

                {/* ════ 출발지 ════ */}
                <Text style={styles.inputLabel}>출발지 (선택)</Text>
                <View style={styles.locSearchBox}>
                  <View style={styles.locInputWrap}>
                    <Text style={styles.locPin}>🚀</Text>
                    <TextInput
                      style={styles.locInput}
                      placeholder="출발 장소 검색..."
                      placeholderTextColor="#555"
                      value={fromQuery}
                      onChangeText={handleFromChange}
                      returnKeyType="search"
                    />
                    {fromQuery.length > 0 && (
                      <TouchableOpacity onPress={clearFrom}>
                        <Text style={styles.locClear}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <PlacesPanel
                    results={fromResults}
                    searching={searchingFrom}
                    showPlaces={showFrom}
                    onSelect={selectFrom}
                  />
                  {!showFrom && form.fromLocation && form.fromAddress ? (
                    <View style={styles.selectedBox}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.selectedName}>{form.fromLocation}</Text>
                        <Text style={styles.selectedAddr}>{form.fromAddress}</Text>
                      </View>
                      <Text style={styles.selectedCheck}>✓</Text>
                    </View>
                  ) : null}
                </View>

                {/* 출발→도착 구분선 */}
                <View style={styles.formRouteDivider}>
                  <View style={styles.formRouteLine} />
                  <Text style={styles.formRouteIcon}>▼</Text>
                  <View style={styles.formRouteLine} />
                </View>

                {/* ════ 도착지 / 장소 ════ */}
                <Text style={styles.inputLabel}>도착지 / 장소 (선택)</Text>
                <View style={styles.locSearchBox}>
                  <View style={styles.locInputWrap}>
                    <Text style={styles.locPin}>📍</Text>
                    <TextInput
                      style={styles.locInput}
                      placeholder="도착 장소 검색 (예: 인천공항, 도쿄 타워...)"
                      placeholderTextColor="#555"
                      value={toQuery}
                      onChangeText={handleToChange}
                      returnKeyType="search"
                    />
                    {toQuery.length > 0 && (
                      <TouchableOpacity onPress={clearTo}>
                        <Text style={styles.locClear}>✕</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  <PlacesPanel
                    results={toResults}
                    searching={searchingTo}
                    showPlaces={showTo}
                    onSelect={selectTo}
                  />
                  {!showTo && form.toLocation && form.toAddress ? (
                    <View style={styles.selectedBox}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.selectedName}>{form.toLocation}</Text>
                        <Text style={styles.selectedAddr}>{form.toAddress}</Text>
                      </View>
                      <Text style={styles.selectedCheck}>✓</Text>
                    </View>
                  ) : null}
                </View>

                {/* 메모 */}
                <TextInput style={[styles.input, { height: 70 }]} placeholder="메모" placeholderTextColor="#aaa"
                  value={form.memo} onChangeText={v => setField('memo', v)} multiline />

                {/* 비용 */}
                <Text style={styles.inputLabel}>비용 (선택)</Text>
                <View style={styles.costInputRow}>
                  <TextInput style={[styles.input, { flex: 1, marginBottom: 0 }]}
                    placeholder="0" placeholderTextColor="#aaa" keyboardType="numeric"
                    value={form.cost} onChangeText={v => setField('cost', v)} />
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.currencyScroll}>
                    {CURRENCIES.map(c => (
                      <TouchableOpacity key={c}
                        style={[styles.currencyChip, form.currency === c && styles.currencyChipActive]}
                        onPress={() => setField('currency', c)}>
                        <Text style={[styles.currencyChipText, form.currency === c && styles.currencyChipTextActive]}>{c}</Text>
                      </TouchableOpacity>
                    ))}
                  </ScrollView>
                </View>

                {/* 카테고리 + 사전결제 (비용이 있을 때만) */}
                {form.cost ? (
                  <>
                    <Text style={[styles.inputLabel, { marginTop: 12 }]}>카테고리</Text>
                    <View style={styles.categoryRow}>
                      {CATEGORIES.map(cat => (
                        <TouchableOpacity key={cat}
                          style={[styles.catChip, form.category === cat && styles.catChipActive]}
                          onPress={() => setField('category', cat)}>
                          <Text style={[styles.catChipText, form.category === cat && styles.catChipTextActive]}>{cat}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                    <TouchableOpacity
                      style={[styles.prepaidBtn, form.prepaid && styles.prepaidBtnOn]}
                      onPress={() => setField('prepaid', !form.prepaid)}
                    >
                      <Text style={[styles.prepaidTxt, form.prepaid && styles.prepaidTxtOn]}>
                        {form.prepaid ? '✓ 사전 결제됨 — 지갑/환전 차감 X' : '☐ 사전 결제 항목인가요?'}
                      </Text>
                    </TouchableOpacity>
                  </>
                ) : null}

                <View style={styles.modalBtns}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setModalVisible(false)}>
                    <Text style={styles.cancelBtnText}>취소</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.confirmBtn} onPress={saveSchedule}>
                    <Text style={styles.confirmBtnText}>{editingId ? '수정' : '추가'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* 항공편 상세 모달 */}
      <FlightDetailModal
        visible={!!flightDetailItem}
        item={flightDetailItem}
        onClose={() => setFlightDetailItem(null)}
      />
    </View>
  );
}

// ── 스타일 ──────────────────────────────────────────────────
const styles = StyleSheet.create({
  container:   { flex: 1, backgroundColor: '#1a1a2e' },
  noDatesBox:  { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 },
  noDatesText: { color: '#aaa', fontSize: 16, textAlign: 'center', marginBottom: 8 },
  noDatesHint: { color: '#666', fontSize: 13, textAlign: 'center' },

  dayTabsContainer: { maxHeight: 80, borderBottomWidth: 1, borderBottomColor: '#0f3460' },
  dayTabsContent:   { paddingHorizontal: 16, paddingVertical: 10, gap: 8 },
  dayTab: {
    alignItems: 'center', paddingHorizontal: 16, paddingVertical: 8,
    borderRadius: 12, backgroundColor: '#16213e', borderWidth: 1, borderColor: '#0f3460',
    minWidth: 64, position: 'relative',
  },
  dayTabActive:      { backgroundColor: '#e94560', borderColor: '#e94560' },
  dayTabLabel:       { color: '#aaa', fontSize: 11, fontWeight: 'bold' },
  dayTabLabelActive: { color: '#fff' },
  dayTabDate:        { color: '#666', fontSize: 12, marginTop: 2 },
  dayTabDateActive:  { color: 'rgba(255,255,255,0.8)' },
  badge: {
    position: 'absolute', top: -6, right: -6, backgroundColor: '#4a9eff',
    borderRadius: 10, minWidth: 18, height: 18,
    justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4,
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },

  scroll:    { padding: 20, paddingBottom: 100 },
  emptyBox:  { alignItems: 'center', marginTop: 60 },
  emptyText: { color: '#aaa', fontSize: 16, marginBottom: 6 },
  emptyHint: { color: '#666', fontSize: 13 },

  scheduleRow: { flexDirection: 'row', marginBottom: 4 },
  timeline:    { width: 24, alignItems: 'center', paddingTop: 18 },
  dot:         { width: 10, height: 10, borderRadius: 5, backgroundColor: '#e94560' },
  line:        { width: 2, flex: 1, backgroundColor: '#0f3460', marginTop: 4 },
  scheduleCard: {
    flex: 1, backgroundColor: '#16213e', borderRadius: 12, padding: 14,
    marginLeft: 10, marginBottom: 10, borderWidth: 1, borderColor: '#0f3460',
  },
  cardHeader:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, position: 'relative' },
  timeBlock:    { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 },
  scheduleTime: { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  durationBadge: {
    backgroundColor: 'rgba(74,158,255,0.15)',
    borderRadius: 8, paddingHorizontal: 7, paddingVertical: 2,
    borderWidth: 1, borderColor: 'rgba(74,158,255,0.25)',
  },
  durationText: { color: '#4a9eff', fontSize: 11, fontWeight: 'bold' },
  cardActions:  { flexDirection: 'row', gap: 6 },
  editBtn:      { padding: 4 },
  editBtnText:  { fontSize: 14 },
  deleteBtn:    { padding: 4 },
  deleteBtnText:{ fontSize: 14 },
  kebabBtn:     { paddingHorizontal: 10, paddingVertical: 4 },
  kebabText:    { color: '#aaa', fontSize: 22, fontWeight: 'bold', lineHeight: 24 },
  kebabMenu:    {
    position: 'absolute', top: 32, right: 6, zIndex: 10,
    backgroundColor: '#0f3460', borderRadius: 10,
    borderWidth: 1, borderColor: '#1a4a7a',
    minWidth: 110, paddingVertical: 4,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
    elevation: 6,
  },
  kebabMenuItem:{ paddingVertical: 10, paddingHorizontal: 14 },
  kebabMenuText:{ color: '#fff', fontSize: 14 },
  kebabDivider: { height: 1, backgroundColor: '#1a4a7a', marginHorizontal: 4 },
  crossDayBtn:  {
    backgroundColor: 'transparent',
    borderWidth: 1, borderColor: '#0f3460', borderStyle: 'dashed',
    borderRadius: 10, padding: 10, alignItems: 'center', marginTop: 6, marginBottom: 6,
  },
  crossDayBtnOn:{
    backgroundColor: 'rgba(74,158,255,0.12)',
    borderColor: '#4a9eff', borderStyle: 'solid',
  },
  crossDayTxt:  { color: '#aaa', fontSize: 13, fontWeight: 'bold' },
  crossDayTxtOn:{ color: '#4a9eff' },
  routeDurationBadge: {
    backgroundColor: 'rgba(76,217,100,0.15)',
    borderWidth: 1, borderColor: 'rgba(76,217,100,0.4)',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5,
    alignSelf: 'flex-start', marginBottom: 6,
  },
  routeDurationText: { color: '#4cd964', fontSize: 12, fontWeight: 'bold' },
  transportBadge: {
    backgroundColor: 'rgba(74,158,255,0.15)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: 'flex-start', marginBottom: 6,
    borderWidth: 1, borderColor: 'rgba(74,158,255,0.3)',
  },
  transportText: { color: '#4a9eff', fontSize: 12 },
  scheduleTitle: { color: '#fff', fontSize: 15, fontWeight: 'bold', marginBottom: 4 },

  // ── 카드 출발지/도착지 ──
  routeBox:    { marginTop: 4, marginBottom: 2 },
  locationRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 3 },
  locFromText: { color: '#4aff91', fontSize: 13, fontWeight: '600' },
  locToText:   { color: '#aaa',    fontSize: 13 },
  locAddrText: { color: '#555',    fontSize: 11, marginTop: 1 },
  mapLink:     { color: '#4a9eff', fontSize: 12, marginLeft: 8, flexShrink: 0 },
  routeDivider: { flexDirection: 'row', alignItems: 'center', marginVertical: 2, gap: 6 },
  routeLine:    { flex: 1, height: 1, backgroundColor: '#0f3460' },
  routeArrow:   { color: '#444', fontSize: 9 },

  memoText: { color: '#888', fontSize: 13, marginTop: 4 },
  costRow:  {
    marginTop: 6, backgroundColor: 'rgba(233,69,96,0.1)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 4, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: 'rgba(233,69,96,0.3)',
  },
  costText: { color: '#e94560', fontSize: 12, fontWeight: 'bold' },

  fab: {
    position: 'absolute', bottom: 30, right: 20,
    backgroundColor: '#e94560', paddingHorizontal: 20, paddingVertical: 14,
    borderRadius: 30, elevation: 5,
  },
  fabText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  modal:        { backgroundColor: '#16213e', borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 24 },
  modalTitle:   { color: '#fff', fontSize: 20, fontWeight: 'bold', marginBottom: 4 },
  modalDayLabel:{ color: '#e94560', fontSize: 13, marginBottom: 16 },
  rowHeader:    { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  inputLabel:   { color: '#aaa', fontSize: 13, marginBottom: 8 },
  toggle:       { color: '#aaa', fontSize: 13, marginBottom: 8 },
  pickerRow: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a2e', borderRadius: 12, padding: 8,
  },
  sep: { color: '#aaa', fontSize: 14, marginHorizontal: 4 },

  // ── 시간 행 ──
  timeRowWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginBottom: 8,
  },
  timeLabelTxt: { color: '#888', fontSize: 12, width: 28 },
  endToggleBtn: {
    paddingHorizontal: 10, paddingVertical: 7,
    borderRadius: 12, borderWidth: 1, borderColor: '#0f3460',
    backgroundColor: '#16213e',
  },
  endToggleBtnOn:  { backgroundColor: '#e94560', borderColor: '#e94560' },
  endToggleTxt:    { color: '#aaa', fontSize: 11, fontWeight: 'bold' },
  endToggleTxtOn:  { color: '#fff' },

  transportScroll: { marginBottom: 14 },
  transportChip: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 20, borderWidth: 1, borderColor: '#0f3460',
    marginRight: 8, backgroundColor: '#1a1a2e',
  },
  transportChipActive:    { backgroundColor: '#4a9eff', borderColor: '#4a9eff' },
  transportEmoji:         { fontSize: 16, marginRight: 4 },
  transportChipText:      { color: '#aaa', fontSize: 12 },
  transportChipTextActive:{ color: '#fff' },

  input: {
    backgroundColor: '#1a1a2e', color: '#fff', padding: 14,
    borderRadius: 10, marginBottom: 12, fontSize: 15, borderWidth: 1, borderColor: '#0f3460',
  },
  costInputRow:    { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
  currencyScroll:  { flex: 1 },
  currencyChip:    { paddingHorizontal: 10, paddingVertical: 8, borderRadius: 16, borderWidth: 1, borderColor: '#0f3460', marginRight: 6 },
  currencyChipActive:    { backgroundColor: '#e94560', borderColor: '#e94560' },
  currencyChipText:      { color: '#aaa', fontSize: 12 },
  currencyChipTextActive:{ color: '#fff' },
  categoryRow:    { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 10 },
  catChip:        { paddingHorizontal: 12, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#0f3460', backgroundColor: '#0f3460' },
  catChipActive:  { backgroundColor: '#e94560', borderColor: '#e94560' },
  catChipText:    { color: '#aaa', fontSize: 12 },
  catChipTextActive:{ color: '#fff', fontWeight: 'bold' },
  prepaidBtn:     { backgroundColor: 'transparent', borderWidth: 1, borderColor: '#0f3460', borderStyle: 'dashed', borderRadius: 10, padding: 10, alignItems: 'center', marginBottom: 8 },
  prepaidBtnOn:   { backgroundColor: 'rgba(255,201,71,0.12)', borderColor: '#ffc947', borderStyle: 'solid' },
  prepaidTxt:     { color: '#aaa', fontSize: 12, fontWeight: 'bold' },
  prepaidTxtOn:   { color: '#ffc947' },
  modalBtns:  { flexDirection: 'row', gap: 10, marginTop: 4 },
  cancelBtn:  { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#0f3460', alignItems: 'center' },
  cancelBtnText: { color: '#aaa', fontSize: 15 },
  confirmBtn: { flex: 1, backgroundColor: '#e94560', padding: 14, borderRadius: 10, alignItems: 'center' },
  confirmBtnText: { color: '#fff', fontSize: 15, fontWeight: 'bold' },

  // ── 장소 검색 공통 ──
  locSearchBox: { marginBottom: 4 },
  locInputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: '#1a1a2e', borderRadius: 10, borderWidth: 1, borderColor: '#0f3460',
    paddingHorizontal: 12, paddingVertical: 10,
  },
  locPin:   { fontSize: 16, marginRight: 8 },
  locInput: { flex: 1, color: '#fff', fontSize: 14 },
  locClear: { color: '#555', fontSize: 16, paddingLeft: 8 },

  placesList: {
    backgroundColor: '#0f3460', borderRadius: 10,
    marginTop: 4, overflow: 'hidden',
    borderWidth: 1, borderColor: '#1a4a80',
  },
  placesLoadRow:  { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 14, paddingHorizontal: 14 },
  placesLoadText: { color: '#aaa', fontSize: 13 },
  placeItem:      { paddingHorizontal: 14, paddingVertical: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  placeItemBorder:{ borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.07)' },
  placeItemLeft:  { flex: 1, marginRight: 8 },
  placeName:      { color: '#fff', fontSize: 14, fontWeight: 'bold', marginBottom: 2 },
  placeAddr:      { color: '#888', fontSize: 11 },
  placeCatBadge:  {
    backgroundColor: 'rgba(233,69,96,0.2)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3,
    borderWidth: 1, borderColor: 'rgba(233,69,96,0.3)',
  },
  placeCatText:  { color: '#e94560', fontSize: 10, fontWeight: 'bold' },
  noPlacesText:  { color: '#555', textAlign: 'center', padding: 16, fontSize: 13 },

  selectedBox:  {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: 'rgba(74,158,255,0.1)', borderRadius: 10,
    padding: 12, marginTop: 4,
    borderWidth: 1, borderColor: 'rgba(74,158,255,0.3)',
  },
  selectedName:  { color: '#fff', fontSize: 13, fontWeight: 'bold' },
  selectedAddr:  { color: '#888', fontSize: 11, marginTop: 2 },
  selectedCheck: { color: '#4aff91', fontSize: 18, fontWeight: 'bold', paddingLeft: 8 },

  // ── 폼 출발→도착 구분선 ──
  formRouteDivider: { flexDirection: 'row', alignItems: 'center', marginVertical: 10, gap: 8 },
  formRouteLine:    { flex: 1, height: 1, backgroundColor: '#0f3460' },
  formRouteIcon:    { color: '#555', fontSize: 14 },

  // ── 항공편 ──
  flightBox: { marginBottom: 12 },
  flightInputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  flightInfoCard: {
    backgroundColor: 'rgba(74,158,255,0.08)',
    borderRadius: 10, padding: 12,
    borderWidth: 1, borderColor: 'rgba(74,158,255,0.2)',
  },
  flightRoute: {
    flexDirection: 'row', alignItems: 'center',
    justifyContent: 'space-between', marginBottom: 6,
  },
  flightAirportBox: { flex: 1, alignItems: 'flex-start' },
  flightIataCode:   { color: '#fff', fontSize: 20, fontWeight: 'bold', letterSpacing: 1 },
  flightAirportName:{ color: '#aaa', fontSize: 11, marginTop: 2, flexShrink: 1 },
  flightArrowBox:   { alignItems: 'center', paddingHorizontal: 8 },
  flightArrow:      { color: '#4a9eff', fontSize: 16 },
  flightArrowLine:  { width: 40, height: 1, backgroundColor: 'rgba(74,158,255,0.4)', marginTop: 2 },
  delayBadge: {
    backgroundColor: 'rgba(255,165,0,0.15)',
    borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: 'rgba(255,165,0,0.3)',
    alignSelf: 'flex-start', marginTop: 4,
  },
  delayText: { color: '#ffa500', fontSize: 12, fontWeight: 'bold' },

  // ── 카드 지연 배지 ──
  flightDelayBadge: {
    backgroundColor: 'rgba(255,165,0,0.15)',
    borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3,
    alignSelf: 'flex-start', marginBottom: 4,
    borderWidth: 1, borderColor: 'rgba(255,165,0,0.3)',
  },
  flightDelayText: { color: '#ffa500', fontSize: 12, fontWeight: 'bold' },
});
