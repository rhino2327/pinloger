import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, ActivityIndicator, Modal, FlatList,
  KeyboardAvoidingView, Platform, Alert,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  collection, addDoc, onSnapshot, query, where,
  deleteDoc, doc, serverTimestamp, updateDoc,
} from 'firebase/firestore';
import { TextInput } from 'react-native';
import { db, auth } from '../config/firebase';

const CURRENCIES = [
  { code: 'KRW', name: '한국 원',        flag: '🇰🇷' },
  { code: 'USD', name: '미국 달러',       flag: '🇺🇸' },
  { code: 'JPY', name: '일본 엔',         flag: '🇯🇵' },
  { code: 'EUR', name: '유로',            flag: '🇪🇺' },
  { code: 'CNY', name: '중국 위안',       flag: '🇨🇳' },
  { code: 'THB', name: '태국 바트',       flag: '🇹🇭' },
  { code: 'VND', name: '베트남 동',       flag: '🇻🇳' },
  { code: 'GBP', name: '영국 파운드',     flag: '🇬🇧' },
  { code: 'AUD', name: '호주 달러',       flag: '🇦🇺' },
  { code: 'SGD', name: '싱가포르 달러',   flag: '🇸🇬' },
];

// 키패드 레이아웃 (오른쪽에 연산자)
const KEYS = [
  ['7', '8', '9', '÷'],
  ['4', '5', '6', '×'],
  ['1', '2', '3', '-'],
  ['.', '0', '⌫', '+'],
];
const OPERATORS = ['+', '-', '×', '÷'];

const formatKRW = (n) =>
  Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 0 }) + ' 원';

const formatForeign = (n, code) => {
  const num = Number(n);
  if (code === 'VND' || code === 'JPY')
    return num.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
  return num.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
};

const todayStr = () => new Date().toISOString().slice(0, 10);

// 통화 → 국가 플래그로 가장 적합한 여행 자동 매칭 (순수 함수)
function findTripForCurrency(currencyCode, trips) {
  const curInfo = CURRENCIES.find(c => c.code === currencyCode);
  if (!curInfo?.flag) return null;
  const matches = trips.filter(t => t.flag === curInfo.flag);
  if (matches.length === 0) return null;
  const today = todayStr();
  // 1순위: 현재 진행 중인 여행
  const active = matches.find(
    t => (t.startDate || '') <= today && (t.endDate || '') >= today
  );
  if (active) return active.id;
  // 2순위: 가장 가까운 예정 여행
  const upcoming = matches
    .filter(t => (t.startDate || '') > today)
    .sort((a, b) => (a.startDate > b.startDate ? 1 : -1));
  if (upcoming.length > 0) return upcoming[0].id;
  // 3순위: 가장 최근 종료된 여행
  const past = matches
    .filter(t => (t.endDate || '') < today)
    .sort((a, b) => (a.endDate > b.endDate ? -1 : 1));
  return past.length > 0 ? past[0].id : null;
}

const formatLiveRate = (ratePerKRW) => {
  if (!ratePerKRW) return null;
  const v = 1 / ratePerKRW;
  if (v >= 100) return String(Math.round(v));
  if (v >= 1)   return v.toFixed(2);
  return v.toFixed(4);
};

// 연산 결과 포맷 (부동소수점 오류 제거)
const fmtResult = (n) => {
  if (!isFinite(n) || isNaN(n)) return '0';
  return String(parseFloat(n.toFixed(10)));
};

const calcOp = (a, b, op) => {
  switch (op) {
    case '+': return a + b;
    case '-': return a - b;
    case '×': return a * b;
    case '÷': return b === 0 ? 0 : a / b;
    default:  return b;
  }
};

// 계산기 디스플레이용 — 정수부 천단위 + 소수부 그대로 유지
const displayFmt = (str) => {
  if (!str || str === '0') return '0';
  const [intPart, decPart] = str.split('.');
  const intNum = parseInt(intPart, 10);
  const formatted = isNaN(intNum) ? '0' : intNum.toLocaleString('ko-KR');
  if (decPart === undefined) return formatted;
  return formatted + '.' + decPart;
};

export default function ExchangeScreen() {
  const insets = useSafeAreaInsets();
  const user   = auth.currentUser;

  // ── 계산기 ──
  const [rates,        setRates]        = useState({});
  const [loading,      setLoading]      = useState(true);
  const [amount,       setAmount]       = useState('1');
  const [fromCurrency, setFromCurrency] = useState('USD');
  const [lastUpdated,  setLastUpdated]  = useState('');
  const [sheetVisible, setSheetVisible] = useState(false);
  // ── 계산기 연산 ──
  const [pendingOp, setPendingOp] = useState(null);   // +,-,×,÷
  const [firstVal,  setFirstVal]  = useState(null);   // 첫 번째 피연산자
  const [justCalc,  setJustCalc]  = useState(false);  // = 직후 플래그

  // ── 탭 ──
  const [activeTab, setActiveTab] = useState('calc');

  // ── 환전 내역 ──
  const [history,   setHistory]   = useState([]);
  const [userTrips, setUserTrips] = useState([]);
  const [saving,    setSaving]    = useState(false);

  // ── 폼 ──
  const [formVisible,        setFormVisible]        = useState(false);
  const [editTarget,         setEditTarget]         = useState(null);
  const [fCurrency,          setFCurrency]          = useState('JPY');
  const [fAmount,            setFAmount]            = useState('');
  const [fRate,              setFRate]              = useState('');
  const [fMemo,              setFMemo]              = useState('');

  // ── 여행별 지출 데이터 (지갑 잔액 계산용) ──
  const [tripCostsData, setTripCostsData] = useState({});
  const costUnsubsRef = useRef([]);

  useEffect(() => {
    fetchRates();
    if (!user) return;
    const q1 = query(collection(db, 'exchanges'), where('uid', '==', user.uid));
    const u1 = onSnapshot(q1, (snap) => {
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      data.sort((a, b) => (b.date || '') > (a.date || '') ? 1 : -1);
      setHistory(data);
    }, (e) => console.warn('exchanges', e));
    const q2 = query(collection(db, 'trips'), where('members', 'array-contains', user.uid));
    const u2 = onSnapshot(q2, (snap) => {
      setUserTrips(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    }, (e) => console.warn('trips', e));
    return () => { u1(); u2(); };
  }, []);

  // ── 여행별 지출 구독 (수동 비용 + 일정 비용) ──
  useEffect(() => {
    costUnsubsRef.current.forEach(u => u());
    costUnsubsRef.current = [];
    if (!user || userTrips.length === 0) return;
    userTrips.forEach(trip => {
      const q1 = query(collection(db, 'costs'), where('tripId', '==', trip.id));
      const u1 = onSnapshot(q1, snap => {
        setTripCostsData(prev => ({
          ...prev,
          [trip.id]: { ...prev[trip.id], manual: snap.docs.map(d => d.data()) },
        }));
      }, () => {});
      const q2 = query(collection(db, 'schedules'), where('tripId', '==', trip.id));
      const u2 = onSnapshot(q2, snap => {
        setTripCostsData(prev => ({
          ...prev,
          [trip.id]: {
            ...prev[trip.id],
            schedule: snap.docs.map(d => d.data()).filter(d => (d.cost || 0) > 0),
          },
        }));
      }, () => {});
      costUnsubsRef.current.push(u1, u2);
    });
    return () => { costUnsubsRef.current.forEach(u => u()); costUnsubsRef.current = []; };
  }, [userTrips.map(t => t.id).join(','), user?.uid]);

  // ── 새 여행 생성 시 미연결 환전 자동 재연결 ──
  useEffect(() => {
    if (!user || userTrips.length === 0 || history.length === 0) return;
    const unlinked = history.filter(h => !h.tripId);
    if (unlinked.length === 0) return;
    unlinked.forEach(item => {
      const matchId = findTripForCurrency(item.currency, userTrips);
      if (matchId) {
        updateDoc(doc(db, 'exchanges', item.id), { tripId: matchId }).catch(() => {});
      }
    });
  }, [
    userTrips.map(t => t.id).join(','),
    history.filter(h => !h.tripId).map(h => h.id).join(','),
  ]);

  const fetchRates = async () => {
    setLoading(true);
    try {
      const res  = await fetch(
        'https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@latest/v1/currencies/krw.json'
      );
      const data = await res.json();
      const normalized = {};
      Object.entries(data.krw || {}).forEach(([k, v]) => {
        normalized[k.toUpperCase()] = v;
      });
      setRates(normalized);
      setLastUpdated(new Date().toLocaleTimeString('ko-KR'));
    } catch {
      setRates({ USD:0.00073, JPY:0.11, EUR:0.00068, CNY:0.0053,
                 THB:0.027, VND:18.5, GBP:0.00058, AUD:0.0011, SGD:0.00099, KRW:1 });
    } finally {
      setLoading(false);
    }
  };

  // ── 계산기 키 입력 ──
  const handleKey = (key) => {
    // 전체 초기화
    if (key === 'C') {
      setAmount('0'); setPendingOp(null); setFirstVal(null); setJustCalc(false);
      return;
    }
    // 백스페이스
    if (key === '⌫') {
      if (justCalc) { setAmount('0'); setJustCalc(false); return; }
      setAmount(prev => prev.length <= 1 ? '0' : prev.slice(0, -1));
      return;
    }
    // 연산자
    if (OPERATORS.includes(key)) {
      const cur = amount;
      if (pendingOp && firstVal !== null && !justCalc) {
        // 체인 연산: 이전 결과를 계산 후 새 연산자 저장
        const result = fmtResult(calcOp(parseFloat(firstVal), parseFloat(cur), pendingOp));
        setFirstVal(result);
        setAmount(result);
      } else {
        setFirstVal(cur);
      }
      setPendingOp(key);
      setJustCalc(true);
      return;
    }
    // 등호
    if (key === '=') {
      if (!pendingOp || firstVal === null) return;
      const result = fmtResult(calcOp(parseFloat(firstVal), parseFloat(amount), pendingOp));
      setAmount(result);
      setPendingOp(null); setFirstVal(null); setJustCalc(true);
      return;
    }
    // 소수점
    if (key === '.') {
      if (justCalc) { setAmount('0.'); setJustCalc(false); return; }
      if (amount.includes('.')) return;
      setAmount(prev => prev + '.');
      return;
    }
    // 숫자
    if (justCalc) { setAmount(key); setJustCalc(false); return; }
    if (amount.replace('.', '').length >= 12) return;
    setAmount(prev => prev === '0' ? key : prev + key);
  };

  // ── 환율 변환 ──
  const convert = (toCurrency) => {
    const n = parseFloat(amount);
    if (!n || !rates[fromCurrency] || !rates[toCurrency]) return '–';
    const inKRW  = n / rates[fromCurrency];
    const result = inKRW * rates[toCurrency];
    if (result >= 1000000) return result.toLocaleString('ko-KR', { maximumFractionDigits: 0 });
    if (result >= 1)       return result.toLocaleString('ko-KR', { maximumFractionDigits: 2 });
    return result.toFixed(4);
  };

  // 여행별 지출 합산 (통화 → 소비금액 맵)
  const getSpentByCurrency = (tripId) => {
    const data = tripCostsData[tripId];
    if (!data) return {};
    const spent = {};
    [...(data.manual || []), ...(data.schedule || [])].forEach(c => {
      const cur = c.currency || 'KRW';
      const amt = Number(c.amount || c.cost || 0);
      if (amt > 0) spent[cur] = (spent[cur] || 0) + amt;
    });
    return spent;
  };

  // 환전 내역을 여행별로 그룹화
  const tripExchangesMap = {};
  const personalExchanges = [];
  history.forEach(item => {
    if (item.tripId) {
      if (!tripExchangesMap[item.tripId]) tripExchangesMap[item.tripId] = [];
      tripExchangesMap[item.tripId].push(item);
    } else {
      personalExchanges.push(item);
    }
  });

  const liveRateStr  = rates[fCurrency] ? formatLiveRate(rates[fCurrency]) : null;
  const fromInfo     = CURRENCIES.find(c => c.code === fromCurrency);
  const totalKRW     = history.reduce((s, h) => s + (h.krwAmount || 0), 0);

  const otherCurrencies = CURRENCIES.filter(c => c.code !== fromCurrency);

  // ── 환전 내역 폼 ──
  const openAdd = () => {
    setEditTarget(null);
    setFCurrency('JPY'); setFAmount(''); setFRate(''); setFMemo('');
    setFormVisible(true);
  };
  const openEdit = (item) => {
    setEditTarget(item);
    setFCurrency(item.currency || 'JPY');
    setFAmount(String(item.foreignAmount ?? ''));
    setFRate(String(item.rate ?? ''));
    setFMemo(item.memo || '');
    setFormVisible(true);
  };
  const handleSave = async () => {
    const amt  = parseFloat(fAmount);
    const rate = parseFloat(fRate);
    if (!fAmount || isNaN(amt) || amt <= 0) { Alert.alert('알림', '외화 금액을 입력해주세요.'); return; }
    if (!fRate || isNaN(rate) || rate <= 0)  { Alert.alert('알림', '적용 환율을 입력해주세요.\n예) 1 JPY = 9.2 원이면 9.2'); return; }
    setSaving(true);
    try {
      const krwAmount = Math.round(amt * rate);
      const autoTripId = findTripForCurrency(fCurrency, userTrips);
      const d = { currency: fCurrency, foreignAmount: amt, rate, krwAmount, memo: fMemo.trim(), tripId: autoTripId };
      if (editTarget) {
        await updateDoc(doc(db, 'exchanges', editTarget.id), d);
      } else {
        await addDoc(collection(db, 'exchanges'), { uid: user.uid, ...d, date: todayStr(), createdAt: serverTimestamp() });
      }
      setFormVisible(false);
    } catch (e) {
      Alert.alert('오류', '저장 중 문제가 발생했어요.');
      console.warn(e);
    } finally {
      setSaving(false);
    }
  };
  const handleDelete = (id) => {
    Alert.alert('삭제', '이 환전 내역을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      { text: '삭제', style: 'destructive', onPress: async () => { try { await deleteDoc(doc(db, 'exchanges', id)); } catch {} } },
    ]);
  };
  const previewKRW = () => {
    const a = parseFloat(fAmount), r = parseFloat(fRate);
    return (!isNaN(a) && a > 0 && !isNaN(r) && r > 0) ? formatKRW(Math.round(a * r)) : null;
  };

  return (
    <View style={styles.container}>
      {/* 헤더 */}
      <View style={[styles.header, { paddingTop: insets.top + 12 }]}>
        <Text style={styles.headerTitle}>환율</Text>
        {activeTab === 'calc' && lastUpdated ? (
          <TouchableOpacity onPress={fetchRates}>
            <Text style={styles.updated}>🔄 {lastUpdated} 기준</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {/* 탭 */}
      <View style={styles.tabs}>
        {[['calc','💱 계산기'],['history','👛 지갑']].map(([key, label]) => (
          <TouchableOpacity
            key={key}
            style={[styles.tab, activeTab === key && styles.tabActive]}
            onPress={() => setActiveTab(key)}
          >
            <Text style={[styles.tabText, activeTab === key && styles.tabTextActive]}>
              {label}{key === 'history' && history.length > 0 ? ` (${history.length})` : ''}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* ══════════ 계산기 탭 ══════════ */}
      {activeTab === 'calc' && (
        loading ? (
          <View style={styles.loadingBox}>
            <ActivityIndicator size="large" color="#e94560" />
            <Text style={styles.loadingText}>환율 정보 불러오는 중...</Text>
          </View>
        ) : (
          <View style={{ flex: 1 }}>
            {/* 금액 디스플레이 */}
            <View style={styles.displayBox}>
              <TouchableOpacity style={styles.fromCurBtn} onPress={() => setSheetVisible(true)}>
                <Text style={styles.fromCurFlag}>{fromInfo?.flag}</Text>
                <Text style={styles.fromCurCode}>{fromCurrency}</Text>
                <Text style={styles.fromCurName}>{fromInfo?.name}</Text>
                <Text style={styles.chevron}>▼</Text>
              </TouchableOpacity>
              {/* 연산 중 힌트 */}
              {pendingOp && firstVal !== null && (
                <Text style={styles.pendingLine}>
                  {displayFmt(firstVal)}  {pendingOp}
                </Text>
              )}
              <Text
                style={styles.displayNum}
                numberOfLines={1}
                adjustsFontSizeToFit
                minimumFontScale={0.5}
              >
                {displayFmt(amount)}
              </Text>
            </View>

            {/* 환율 결과 목록 — 탭하면 기준 통화 변경 */}
            <FlatList
              data={otherCurrencies}
              keyExtractor={c => c.code}
              style={styles.resultList}
              contentContainerStyle={{ paddingHorizontal: 16, paddingVertical: 8 }}
              showsVerticalScrollIndicator={false}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.resultCard}
                  onPress={() => {
                    // 이 통화를 기준으로 변경
                    const convertedVal = parseFloat(convert(item.code));
                    if (!isNaN(convertedVal)) {
                      setAmount(String(convertedVal % 1 === 0 ? convertedVal.toFixed(0) : convertedVal.toFixed(4)));
                    }
                    setFromCurrency(item.code);
                  }}
                  activeOpacity={0.7}
                >
                  <View style={styles.resultLeft}>
                    <Text style={styles.resultFlag}>{item.flag}</Text>
                    <View>
                      <Text style={styles.resultCode}>{item.code}</Text>
                      <Text style={styles.resultName}>{item.name}</Text>
                    </View>
                  </View>
                  <View style={styles.resultRight}>
                    <Text style={styles.resultAmount}>{convert(item.code)}</Text>
                    <Text style={styles.resultHint}>탭하여 전환</Text>
                  </View>
                </TouchableOpacity>
              )}
            />

            {/* 계산기 키패드 */}
            <View style={[styles.keypad, { paddingBottom: insets.bottom + 8 }]}>
              {KEYS.map((row, ri) => (
                <View key={ri} style={styles.keyRow}>
                  {row.map(key => {
                    const isOp  = OPERATORS.includes(key);
                    const isDel = key === '⌫';
                    const isActiveOp = isOp && pendingOp === key && justCalc;
                    return (
                      <TouchableOpacity
                        key={key}
                        style={[
                          styles.key,
                          isOp  && styles.keyOp,
                          isDel && styles.keyDel,
                          isActiveOp && styles.keyOpActive,
                        ]}
                        onPress={() => handleKey(key)}
                        activeOpacity={0.6}
                      >
                        <Text style={[
                          styles.keyText,
                          isOp  && styles.keyOpText,
                          isDel && styles.keyDelText,
                          isActiveOp && styles.keyOpActiveText,
                        ]}>
                          {key}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))}
              {/* C + = 하단 */}
              <View style={styles.keyRow}>
                <TouchableOpacity
                  style={[styles.key, styles.keyClear, { flex: 2, marginRight: 10 }]}
                  onPress={() => handleKey('C')}
                  activeOpacity={0.6}
                >
                  <Text style={styles.keyClearText}>C</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.key, styles.keyEquals]}
                  onPress={() => handleKey('=')}
                  activeOpacity={0.6}
                >
                  <Text style={styles.keyEqualsText}>=</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        )
      )}

      {/* ══════════ 지갑 탭 ══════════ */}
      {activeTab === 'history' && (
        <View style={{ flex: 1 }}>
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 120 }}>
            {/* 총 환전 요약 */}
            {history.length > 0 && (
              <View style={styles.summaryCard}>
                <Text style={styles.summaryLabel}>총 환전 금액</Text>
                <Text style={styles.summaryAmount}>{formatKRW(totalKRW)}</Text>
                <Text style={styles.summaryCount}>{history.length}건</Text>
              </View>
            )}

            {history.length === 0 ? (
              <View style={styles.emptyBox}>
                <Text style={styles.emptyIcon}>👛</Text>
                <Text style={styles.emptyText}>환전 내역이 없어요.{'\n'}+ 버튼으로 추가해보세요!</Text>
              </View>
            ) : (
              <>
                {/* ── 여행별 그룹 ── */}
                {Object.entries(tripExchangesMap).map(([tripId, items]) => {
                  const tripInfo = userTrips.find(t => t.id === tripId);
                  const spentMap = getSpentByCurrency(tripId);

                  // 통화별 환전 집계
                  const byCur = {};
                  items.forEach(item => {
                    if (!byCur[item.currency]) byCur[item.currency] = { total: 0, krwTotal: 0, items: [] };
                    byCur[item.currency].total    += item.foreignAmount || 0;
                    byCur[item.currency].krwTotal += item.krwAmount     || 0;
                    byCur[item.currency].items.push(item);
                  });

                  return (
                    <View key={tripId} style={styles.walletGroup}>
                      {/* 여행 헤더 */}
                      <View style={styles.walletGroupHeader}>
                        <Text style={styles.walletGroupFlag}>{tripInfo?.flag || '🌍'}</Text>
                        <Text style={styles.walletGroupName}>{tripInfo?.name || '알 수 없는 여행'}</Text>
                      </View>

                      {/* 통화별 잔액 카드 */}
                      {Object.entries(byCur).map(([cur, data]) => {
                        const curInfo   = CURRENCIES.find(c => c.code === cur);
                        const spent     = spentMap[cur] || 0;
                        const remaining = data.total - spent;
                        const isOver    = remaining < 0;
                        const progress  = data.total > 0 ? Math.min(spent / data.total, 1) : 0;

                        return (
                          <View key={cur} style={styles.walletCurBlock}>
                            {/* 통화 헤더 + 잔액 */}
                            <View style={styles.walletCurHeader}>
                              <Text style={styles.walletCurFlag}>{curInfo?.flag || '💱'}</Text>
                              <Text style={styles.walletCurCode}>{cur}</Text>
                              <View style={{ flex: 1 }} />
                              <View style={{ alignItems: 'flex-end' }}>
                                <Text style={styles.walletExchanged}>
                                  환전 {formatForeign(data.total, cur)} {cur}
                                </Text>
                                <Text style={[styles.walletRemaining, isOver && styles.walletOver]}>
                                  {isOver ? '⚠️ 초과 ' : '잔액 '}
                                  {formatForeign(Math.abs(remaining), cur)} {cur}
                                </Text>
                              </View>
                            </View>

                            {/* 프로그레스 바 */}
                            <View style={styles.walletProgressWrap}>
                              <View style={styles.walletProgressBar}>
                                <View style={[
                                  styles.walletProgressFill,
                                  { width: `${Math.min(progress * 100, 100)}%` },
                                  isOver && styles.walletProgressOver,
                                ]} />
                              </View>
                              <Text style={styles.walletSpentLabel}>
                                사용 {formatForeign(spent, cur)} {cur}
                              </Text>
                            </View>

                            {/* 환전 내역 */}
                            {data.items.map(item => (
                              <View key={item.id} style={styles.walletRecord}>
                                <View style={{ flex: 1 }}>
                                  <Text style={styles.walletRecordAmt}>
                                    +{formatForeign(item.foreignAmount, cur)} {cur}
                                  </Text>
                                  <Text style={styles.walletRecordRate}>
                                    1 {cur} = {(item.rate||0).toLocaleString('ko-KR')} 원 → {formatKRW(item.krwAmount||0)}
                                  </Text>
                                  {item.date ? <Text style={styles.walletRecordDate}>{item.date}</Text> : null}
                                  {item.memo ? <Text style={styles.walletRecordMemo}>📝 {item.memo}</Text> : null}
                                </View>
                                <View style={styles.cardActions}>
                                  <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(item)}>
                                    <Text style={styles.editBtnText}>수정</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity style={styles.delBtn} onPress={() => handleDelete(item.id)}>
                                    <Text style={styles.delBtnText}>🗑</Text>
                                  </TouchableOpacity>
                                </View>
                              </View>
                            ))}
                          </View>
                        );
                      })}
                    </View>
                  );
                })}

                {/* ── 여행 미연결 환전 ── */}
                {personalExchanges.length > 0 && (
                  <View style={styles.walletGroup}>
                    <View style={styles.walletGroupHeader}>
                      <Text style={styles.walletGroupFlag}>💼</Text>
                      <Text style={styles.walletGroupName}>여행 미연결</Text>
                    </View>
                    {personalExchanges.map(item => {
                      const info = CURRENCIES.find(c => c.code === item.currency);
                      return (
                        <View key={item.id} style={styles.historyCard}>
                          <View style={styles.historyTop}>
                            <View style={styles.historyLeft}>
                              <Text style={styles.historyFlag}>{info?.flag || '💱'}</Text>
                              <View style={{ flex: 1 }}>
                                <Text style={styles.historyForeign}>
                                  {formatForeign(item.foreignAmount, item.currency)} {item.currency}
                                </Text>
                                <Text style={styles.historyDate}>{item.date}</Text>
                              </View>
                            </View>
                            <View style={styles.cardActions}>
                              <TouchableOpacity style={styles.editBtn} onPress={() => openEdit(item)}>
                                <Text style={styles.editBtnText}>수정</Text>
                              </TouchableOpacity>
                              <TouchableOpacity style={styles.delBtn} onPress={() => handleDelete(item.id)}>
                                <Text style={styles.delBtnText}>🗑</Text>
                              </TouchableOpacity>
                            </View>
                          </View>
                          <View style={styles.historyDivider} />
                          <View style={styles.historyBottom}>
                            <View style={styles.infoRow}>
                              <Text style={styles.infoLabel}>적용 환율</Text>
                              <Text style={styles.infoValue}>1 {item.currency} = {(item.rate||0).toLocaleString('ko-KR')} 원</Text>
                            </View>
                            <View style={styles.infoRow}>
                              <Text style={styles.infoLabel}>원화 환산</Text>
                              <Text style={styles.infoKRW}>{formatKRW(item.krwAmount||0)}</Text>
                            </View>
                            {item.memo ? <Text style={styles.historyMemo}>📝 {item.memo}</Text> : null}
                          </View>
                        </View>
                      );
                    })}
                  </View>
                )}
              </>
            )}
          </ScrollView>

          <TouchableOpacity style={[styles.addFab, { bottom: insets.bottom + 16 }]} onPress={openAdd}>
            <Text style={styles.addFabText}>+ 환전 추가</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ══ 계산기 통화 선택 ══ */}
      <Modal visible={sheetVisible} transparent animationType="slide">
        <TouchableOpacity style={styles.overlay} activeOpacity={1} onPress={() => setSheetVisible(false)} />
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>기준 통화 선택</Text>
          <FlatList
            data={CURRENCIES}
            keyExtractor={c => c.code}
            showsVerticalScrollIndicator={false}
            renderItem={({ item }) => {
              const active = fromCurrency === item.code;
              return (
                <TouchableOpacity
                  style={[styles.sheetItem, active && styles.sheetItemActive]}
                  onPress={() => { setFromCurrency(item.code); setSheetVisible(false); }}
                >
                  <Text style={styles.sheetFlag}>{item.flag}</Text>
                  <View style={styles.sheetInfo}>
                    <Text style={[styles.sheetCode, active && styles.sheetCodeActive]}>{item.code}</Text>
                    <Text style={styles.sheetName}>{item.name}</Text>
                  </View>
                  {active && <Text style={styles.sheetCheck}>✓</Text>}
                </TouchableOpacity>
              );
            }}
          />
        </View>
      </Modal>

      {/* ══ 환전 추가/수정 폼 ══ */}
      <Modal visible={formVisible} transparent animationType="slide">
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
          <View style={styles.formOverlay}>
            <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              <View style={[styles.formSheet, { paddingBottom: insets.bottom + 24 }]}>
                <View style={styles.handle} />
                <Text style={styles.formTitle}>{editTarget ? '환전 내역 수정' : '환전 내역 추가'}</Text>

                <Text style={styles.formLabel}>통화</Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginBottom: 14 }} keyboardShouldPersistTaps="handled">
                  {CURRENCIES.filter(c => c.code !== 'KRW').map(c => (
                    <TouchableOpacity
                      key={c.code}
                      style={[styles.chip, fCurrency === c.code && styles.chipActive]}
                      onPress={() => setFCurrency(c.code)}
                    >
                      <Text style={[styles.chipText, fCurrency === c.code && styles.chipTextActive]}>
                        {c.flag} {c.code}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>

                <Text style={styles.formLabel}>환전 금액 ({fCurrency})</Text>
                <TextInput
                  style={styles.formInput}
                  value={fAmount}
                  onChangeText={setFAmount}
                  keyboardType="numeric"
                  placeholder={fCurrency === 'JPY' ? '예: 10000' : '예: 100'}
                  placeholderTextColor="#555"
                />

                <View style={styles.rateHeader}>
                  <Text style={styles.formLabel}>적용 환율 (1 {fCurrency} = ? 원)</Text>
                  {liveRateStr && (
                    <TouchableOpacity style={styles.liveBtn} onPress={() => setFRate(liveRateStr)}>
                      <Text style={styles.liveBtnText}>현재 환율 ≈ {liveRateStr}원</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <TextInput
                  style={styles.formInput}
                  value={fRate}
                  onChangeText={setFRate}
                  keyboardType="numeric"
                  placeholder={fCurrency === 'JPY' ? '예: 9.2' : '예: 1380'}
                  placeholderTextColor="#555"
                />

                {previewKRW() && (
                  <View style={styles.previewBox}>
                    <Text style={styles.previewLabel}>원화 환산</Text>
                    <Text style={styles.previewValue}>{previewKRW()}</Text>
                  </View>
                )}

                <Text style={styles.formLabel}>메모 (선택)</Text>
                <TextInput
                  style={styles.formInput}
                  value={fMemo}
                  onChangeText={setFMemo}
                  placeholder="예: 공항 환전소"
                  placeholderTextColor="#555"
                />

                {/* 자동 여행 연결 표시 */}
                {(() => {
                  const autoId   = findTripForCurrency(fCurrency, userTrips);
                  const autoTrip = userTrips.find(t => t.id === autoId);
                  if (!autoTrip) return (
                    <View style={styles.autoTripNone}>
                      <Text style={styles.autoTripNoneText}>💼 매칭되는 여행이 없어 개인 기록으로 저장돼요</Text>
                    </View>
                  );
                  return (
                    <View style={styles.autoTripInfo}>
                      <Text style={styles.autoTripInfoText}>
                        ✓ {autoTrip.flag || '🌍'} {autoTrip.name}에 자동 연결됩니다
                      </Text>
                    </View>
                  );
                })()}

                <View style={styles.formBtns}>
                  <TouchableOpacity style={styles.cancelBtn} onPress={() => setFormVisible(false)}>
                    <Text style={styles.cancelText}>취소</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.confirmBtn, saving && { opacity: 0.6 }]}
                    onPress={handleSave} disabled={saving}
                  >
                    <Text style={styles.confirmText}>{editTarget ? '수정 완료' : '추가'}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </Modal>

    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#1a1a2e' },

  header: {
    paddingHorizontal: 20, paddingBottom: 12,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end',
  },
  headerTitle: { color: '#fff', fontSize: 26, fontWeight: 'bold' },
  updated:     { color: '#aaa', fontSize: 12 },

  tabs: {
    flexDirection: 'row', marginHorizontal: 20, marginBottom: 12,
    backgroundColor: '#16213e', borderRadius: 12, padding: 4,
  },
  tab:           { flex: 1, paddingVertical: 10, borderRadius: 10, alignItems: 'center' },
  tabActive:     { backgroundColor: '#e94560' },
  tabText:       { color: '#aaa', fontSize: 13, fontWeight: 'bold' },
  tabTextActive: { color: '#fff' },

  loadingBox:  { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { color: '#aaa', marginTop: 12, fontSize: 14 },

  // ── 계산기 디스플레이 ──
  displayBox: {
    marginHorizontal: 16, marginBottom: 8,
    backgroundColor: '#0f3460', borderRadius: 16,
    padding: 16,
  },
  fromCurBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    alignSelf: 'flex-start',
    backgroundColor: '#16213e', borderRadius: 12,
    paddingHorizontal: 12, paddingVertical: 7,
    marginBottom: 10,
  },
  fromCurFlag: { fontSize: 20 },
  fromCurCode: { color: '#e94560', fontSize: 16, fontWeight: 'bold' },
  fromCurName: { color: '#aaa', fontSize: 11 },
  chevron:     { color: '#aaa', fontSize: 11 },
  displayNum: {
    color: '#fff', fontSize: 44, fontWeight: 'bold',
    textAlign: 'right', letterSpacing: 1,
  },

  // ── 결과 목록 ──
  resultList: { flex: 1 },
  resultCard: {
    backgroundColor: '#16213e', borderRadius: 12, padding: 14,
    marginBottom: 8, flexDirection: 'row',
    justifyContent: 'space-between', alignItems: 'center',
    borderWidth: 1, borderColor: '#0f3460',
  },
  resultLeft:   { flexDirection: 'row', alignItems: 'center' },
  resultFlag:   { fontSize: 26, marginRight: 12 },
  resultCode:   { color: '#fff', fontSize: 15, fontWeight: 'bold' },
  resultName:   { color: '#aaa', fontSize: 11, marginTop: 1 },
  resultRight:  { alignItems: 'flex-end' },
  resultAmount: { color: '#e94560', fontSize: 18, fontWeight: 'bold' },
  resultHint:   { color: '#333', fontSize: 9, marginTop: 2 },

  // ── 계산기 디스플레이 연산 힌트 ──
  pendingLine: { color: '#888', fontSize: 14, textAlign: 'right', marginBottom: 2 },

  // ── 키패드 ──
  keypad: {
    backgroundColor: '#0f3460',
    paddingHorizontal: 10, paddingTop: 8,
    borderTopLeftRadius: 20, borderTopRightRadius: 20,
  },
  keyRow: { flexDirection: 'row', gap: 7, marginBottom: 7 },
  key: {
    flex: 1, paddingVertical: 11,
    backgroundColor: '#16213e', borderRadius: 12,
    alignItems: 'center', justifyContent: 'center',
  },
  keyText:    { color: '#fff', fontSize: 18, fontWeight: '600' },
  // 백스페이스
  keyDel:     { backgroundColor: 'rgba(233,69,96,0.15)' },
  keyDelText: { color: '#e94560', fontSize: 18 },
  // 연산자 (+,-,×,÷)
  keyOp:          { backgroundColor: 'rgba(255,159,10,0.15)' },
  keyOpText:      { color: '#ff9f0a', fontSize: 19, fontWeight: 'bold' },
  keyOpActive:    { backgroundColor: 'rgba(255,159,10,0.45)', borderWidth: 1, borderColor: '#ff9f0a' },
  keyOpActiveText:{ color: '#fff' },
  // C 버튼
  keyClear:     { backgroundColor: 'rgba(233,69,96,0.12)', borderWidth: 1, borderColor: 'rgba(233,69,96,0.3)' },
  keyClearText: { color: '#e94560', fontSize: 17, fontWeight: 'bold' },
  // = 버튼
  keyEquals:     { backgroundColor: '#e94560' },
  keyEqualsText: { color: '#fff', fontSize: 21, fontWeight: 'bold' },

  // ── 환전 내역 ──
  summaryCard: {
    marginHorizontal: 20, marginBottom: 12,
    backgroundColor: 'rgba(233,69,96,0.12)', borderRadius: 14,
    borderWidth: 1, borderColor: 'rgba(233,69,96,0.3)',
    paddingHorizontal: 20, paddingVertical: 14,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
  },
  summaryLabel:  { color: '#e94560', fontSize: 13 },
  summaryAmount: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  summaryCount:  { color: '#aaa', fontSize: 13 },

  historyList: { paddingHorizontal: 20, paddingBottom: 120 },
  historyCard: {
    backgroundColor: '#16213e', borderRadius: 14, marginBottom: 12,
    borderWidth: 1, borderColor: '#0f3460',
  },
  historyTop:     { flexDirection: 'row', alignItems: 'flex-start', padding: 16, paddingBottom: 12 },
  historyLeft:    { flexDirection: 'row', gap: 12, flex: 1 },
  historyFlag:    { fontSize: 32 },
  historyForeign: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  historyDate:    { color: '#666', fontSize: 12, marginTop: 2 },
  tripBadge: {
    backgroundColor: 'rgba(74,158,255,0.15)', borderRadius: 8,
    paddingHorizontal: 8, paddingVertical: 3, marginTop: 4, alignSelf: 'flex-start',
  },
  tripBadgeText: { color: '#4a9eff', fontSize: 11 },
  cardActions:   { flexDirection: 'row', gap: 8 },
  editBtn:       { backgroundColor: '#0f3460', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  editBtnText:   { color: '#4a9eff', fontSize: 13, fontWeight: 'bold' },
  delBtn:        { padding: 6 },
  delBtnText:    { fontSize: 16 },
  historyDivider:{ height: 1, backgroundColor: '#0f3460' },
  historyBottom: { padding: 16, paddingTop: 12, gap: 6 },
  infoRow:       { flexDirection: 'row', justifyContent: 'space-between' },
  infoLabel:     { color: '#888', fontSize: 13 },
  infoValue:     { color: '#aaa', fontSize: 13 },
  infoKRW:       { color: '#e94560', fontSize: 17, fontWeight: 'bold' },
  historyMemo:   { color: '#666', fontSize: 12 },

  emptyBox:  { flex: 1, justifyContent: 'center', alignItems: 'center', paddingBottom: 80 },
  emptyIcon: { fontSize: 52, marginBottom: 14 },
  emptyText: { color: '#aaa', textAlign: 'center', fontSize: 15, lineHeight: 24 },
  addFab: {
    position: 'absolute', left: 20, right: 20,
    backgroundColor: '#e94560', borderRadius: 16, paddingVertical: 16,
    alignItems: 'center', elevation: 5,
  },
  addFabText: { color: '#fff', fontSize: 16, fontWeight: 'bold' },

  // ── 폼 ──
  formOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.7)', justifyContent: 'flex-end' },
  formSheet: {
    backgroundColor: '#16213e',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 24, paddingTop: 8,
  },
  formTitle: { color: '#fff', fontSize: 19, fontWeight: 'bold', textAlign: 'center', marginBottom: 20 },
  formLabel: { color: '#aaa', fontSize: 13, marginBottom: 6 },
  formInput: {
    backgroundColor: '#0f3460', color: '#fff', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 12,
  },
  chip: {
    paddingHorizontal: 14, paddingVertical: 8, borderRadius: 20,
    borderWidth: 1, borderColor: '#0f3460', marginRight: 8,
  },
  chipActive:    { backgroundColor: '#e94560', borderColor: '#e94560' },
  chipText:      { color: '#aaa', fontSize: 13 },
  chipTextActive:{ color: '#fff' },
  rateHeader:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  liveBtn:      { backgroundColor: 'rgba(74,255,145,0.15)', borderRadius: 8, paddingHorizontal: 10, paddingVertical: 4 },
  liveBtnText:  { color: '#4aff91', fontSize: 11, fontWeight: 'bold' },
  previewBox: {
    backgroundColor: 'rgba(233,69,96,0.12)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(233,69,96,0.3)',
    paddingHorizontal: 14, paddingVertical: 10,
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: 12,
  },
  previewLabel: { color: '#e94560', fontSize: 13 },
  previewValue: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  tripBtn: {
    backgroundColor: '#0f3460', borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', marginBottom: 4,
  },
  tripBtnSelected:   { flex: 1, color: '#4a9eff', fontSize: 14, fontWeight: 'bold' },
  tripBtnPlaceholder:{ flex: 1, color: '#555', fontSize: 13 },
  clearTrip: { color: '#e94560', fontSize: 12, textAlign: 'right', marginBottom: 12 },
  formBtns:   { flexDirection: 'row', gap: 10, marginTop: 16 },
  cancelBtn:  { flex: 1, padding: 14, borderRadius: 10, borderWidth: 1, borderColor: '#0f3460', alignItems: 'center' },
  cancelText: { color: '#aaa', fontSize: 15 },
  confirmBtn: { flex: 1, backgroundColor: '#e94560', padding: 14, borderRadius: 10, alignItems: 'center' },
  confirmText:{ color: '#fff', fontSize: 15, fontWeight: 'bold' },

  // ── 바텀시트 ──
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' },
  sheet: {
    backgroundColor: '#16213e',
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingHorizontal: 20, maxHeight: '70%',
  },
  handle:         { width: 40, height: 4, backgroundColor: '#0f3460', borderRadius: 2, alignSelf: 'center', marginTop: 12, marginBottom: 16 },
  sheetTitle:     { color: '#fff', fontSize: 17, fontWeight: 'bold', marginBottom: 16, textAlign: 'center' },
  sheetItem:      { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 12, borderRadius: 12, marginBottom: 4 },
  sheetItemActive:{ backgroundColor: 'rgba(233,69,96,0.15)' },
  sheetFlag:      { fontSize: 26, marginRight: 14 },
  sheetInfo:      { flex: 1 },
  sheetCode:      { color: '#ccc', fontSize: 16, fontWeight: 'bold' },
  sheetCodeActive:{ color: '#e94560' },
  sheetName:      { color: '#666', fontSize: 12, marginTop: 2 },
  sheetCheck:     { color: '#e94560', fontSize: 18, fontWeight: 'bold' },
  noTrips:        { color: '#666', textAlign: 'center', paddingVertical: 20 },

  // ── 자동 여행 연결 표시 ──
  autoTripInfo: {
    backgroundColor: 'rgba(74,158,255,0.1)', borderRadius: 10,
    borderWidth: 1, borderColor: 'rgba(74,158,255,0.3)',
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14,
  },
  autoTripInfoText: { color: '#4a9eff', fontSize: 13 },
  autoTripNone: {
    backgroundColor: 'rgba(255,255,255,0.05)', borderRadius: 10,
    borderWidth: 1, borderColor: '#0f3460',
    paddingHorizontal: 14, paddingVertical: 10, marginBottom: 14,
  },
  autoTripNoneText: { color: '#555', fontSize: 12 },

  // ── 지갑 탭 — 여행별 그룹 ──
  walletGroup: { marginHorizontal: 16, marginBottom: 20 },
  walletGroupHeader: {
    flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10,
    borderBottomWidth: 1, borderBottomColor: '#0f3460', paddingBottom: 8,
  },
  walletGroupFlag: { fontSize: 24 },
  walletGroupName: { color: '#fff', fontSize: 15, fontWeight: 'bold' },

  walletCurBlock: {
    backgroundColor: '#16213e', borderRadius: 14, borderWidth: 1,
    borderColor: '#0f3460', padding: 14, marginBottom: 10,
  },
  walletCurHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  walletCurFlag:   { fontSize: 20, marginRight: 6 },
  walletCurCode:   { color: '#fff', fontSize: 14, fontWeight: 'bold' },
  walletExchanged: { color: '#aaa', fontSize: 11, marginBottom: 2 },
  walletRemaining: { color: '#4aff91', fontSize: 14, fontWeight: 'bold' },
  walletOver:      { color: '#e94560' },

  walletProgressWrap: { marginBottom: 8 },
  walletProgressBar:  { height: 5, backgroundColor: '#0f3460', borderRadius: 3, overflow: 'hidden', marginBottom: 3 },
  walletProgressFill: { height: '100%', backgroundColor: '#4aff91', borderRadius: 3 },
  walletProgressOver: { backgroundColor: '#e94560' },
  walletSpentLabel:   { color: '#888', fontSize: 11 },

  walletRecord: {
    flexDirection: 'row', alignItems: 'flex-start',
    paddingVertical: 8, borderTopWidth: 1, borderTopColor: 'rgba(15,52,96,0.5)',
  },
  walletRecordAmt:  { color: '#4aff91', fontSize: 13, fontWeight: 'bold', marginBottom: 2 },
  walletRecordRate: { color: '#4a9eff', fontSize: 11, marginBottom: 1 },
  walletRecordDate: { color: '#555', fontSize: 11 },
  walletRecordMemo: { color: '#666', fontSize: 11 },
});
